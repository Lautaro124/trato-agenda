import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  consultaTsquery,
  describirStock,
  fusionarRankings,
  hayStock,
  normalizarTexto,
  unidadesDisponibles,
  type Ranking,
} from './catalogo.rules.js';
import { EmbeddingsClient, literalVector } from './embeddings.client.js';

/** Productos que devuelve una búsqueda del asistente: los que entran en un mensaje de WhatsApp. */
export const RESULTADOS_POR_BUSQUEDA = 8;

/** Candidatos que aporta cada estrategia antes de fusionar. */
const CANDIDATOS = 30;

/** Palabras más cortas no se comparan por trigramas: "la" se parece a medio catálogo. */
const LARGO_MIN_TRIGRAMAS = 4;

/** Umbral de word_similarity por palabra (0..1): tolera "remra" por "remera". */
const UMBRAL_TRIGRAMAS = 0.5;

/**
 * Distancia coseno máxima para que un producto cuente como parecido. El
 * vecino más cercano existe siempre, aunque el comercio venda ropa y el
 * cliente pida pizza: sin tope, eso llegaría como "resultado".
 *
 * Calibrado con text-embedding-3-small sobre `textoBusqueda`: lo pertinente
 * quedó entre 0.54 y 0.65 ("tengo frío" → buzo, "salir a correr" →
 * zapatillas) y lo ajeno por encima de 0.72 ("¿tenés pizza?" en un comercio de
 * ropa y mates). Cambiar de modelo obliga a recalibrarlo.
 */
const DISTANCIA_MAXIMA = 0.7;

/** Lo exacto (código o SKU tipeado tal cual) pesa más que cualquier parecido. */
const PESO_EXACTO = 3;

export type VarianteEncontrada = {
  varianteId: string;
  sku: string;
  nombre: string;
  precioCentavos: number;
  hayStock: boolean;
  /** "disponible" | "quedan N unidades" | "sin stock" — ver describirStock. Lo que puede leer un cliente. */
  stock: string;
  /** Unidades vendibles ya descontadas las reservas; null sin control de cantidad. Sólo para el dueño. */
  unidades: number | null;
  reservadas: number;
  stockMinimo: number | null;
};

export type ProductoEncontrado = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  descripcion: string;
  variantes: VarianteEncontrada[];
};

export type OpcionesBusqueda = {
  categoria?: string | null;
  limite?: number;
  /** Unidades reservadas por pedidos pendientes, por varianteId. */
  reservadas?: Map<string, number>;
};

/**
 * El RAG del asistente de ventas. Cuatro estrategias sobre el catálogo de UNA
 * cuenta, fusionadas por posición (Reciprocal Rank Fusion, catalogo.rules.ts):
 *
 * - exacta: el cliente escribió un código o SKU;
 * - full-text en español (con stemming: "remeras" encuentra "remera");
 * - trigramas, para los errores de tipeo;
 * - embeddings, para lo que se pide por significado ("algo para regalarle a
 *   mi vieja que toma mate").
 *
 * Si OpenRouter no responde, la búsqueda sigue con las tres primeras. Todas
 * filtran por `userId` en SQL: nada de otro comercio puede aparecer.
 */
@Injectable()
export class BusquedaService {
  private readonly logger = new Logger(BusquedaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  async buscar(userId: string, consulta: string, opciones: OpcionesBusqueda = {}): Promise<ProductoEncontrado[]> {
    const texto = normalizarTexto(consulta).slice(0, 300);
    if (!texto) return [];
    const categoria = opciones.categoria?.trim() || null;

    const [exactos, fullText, trigramas, vectoriales] = await Promise.all([
      this.exactos(userId, texto),
      this.fullText(userId, texto, categoria),
      this.trigramas(userId, texto, categoria),
      this.vectoriales(userId, texto, categoria),
    ]);

    const rankings: Ranking[] = [
      { ids: exactos, peso: PESO_EXACTO },
      { ids: fullText },
      { ids: trigramas },
      { ids: vectoriales },
    ];
    const ids = fusionarRankings(rankings, opciones.limite ?? RESULTADOS_POR_BUSQUEDA);
    return this.cargar(userId, ids, opciones.reservadas ?? new Map());
  }

  private async exactos(userId: string, texto: string): Promise<string[]> {
    const tokens = [texto, ...texto.split(' ')].map((token) => token.replace(/[¿?¡!,;:()"']/g, '')).filter(Boolean);
    const filas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT p."id" FROM "Producto" p
      LEFT JOIN "Variante" v ON v."productoId" = p."id" AND v."activo"
      WHERE p."userId" = ${userId} AND p."activo"
        AND (lower(p."codigo") = ANY(${tokens}) OR lower(v."sku") = ANY(${tokens}))
      LIMIT 5
    `;
    return filas.map((fila) => fila.id);
  }

  private async fullText(userId: string, texto: string, categoria: string | null): Promise<string[]> {
    const tsquery = consultaTsquery(texto);
    if (!tsquery) return [];
    const filas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "Producto" p
      WHERE p."userId" = ${userId} AND p."activo"
        AND (${categoria}::text IS NULL OR lower(p."categoria") = lower(${categoria}::text))
        AND p."busqueda" @@ to_tsquery('spanish', ${tsquery})
      ORDER BY ts_rank_cd(p."busqueda", to_tsquery('spanish', ${tsquery})) DESC, p."id"
      LIMIT ${CANDIDATOS}
    `;
    return filas.map((fila) => fila.id);
  }

  private async trigramas(userId: string, texto: string, categoria: string | null): Promise<string[]> {
    const palabras = [
      ...new Set(
        texto
          .split(' ')
          .map((palabra) => palabra.replace(/[^a-z0-9ñ-]/g, ''))
          .filter((palabra) => palabra.length >= LARGO_MIN_TRIGRAMAS),
      ),
    ].slice(0, 6);
    if (palabras.length === 0) return [];
    const filas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "Producto" p, unnest(${palabras}::text[]) AS palabra
      WHERE p."userId" = ${userId} AND p."activo"
        AND (${categoria}::text IS NULL OR lower(p."categoria") = lower(${categoria}::text))
      GROUP BY p."id"
      HAVING max(word_similarity(palabra, p."textoBusqueda")) >= ${UMBRAL_TRIGRAMAS}
      ORDER BY sum(CASE WHEN word_similarity(palabra, p."textoBusqueda") >= ${UMBRAL_TRIGRAMAS}
                        THEN word_similarity(palabra, p."textoBusqueda") ELSE 0 END) DESC, p."id"
      LIMIT ${CANDIDATOS}
    `;
    return filas.map((fila) => fila.id);
  }

  private async vectoriales(userId: string, texto: string, categoria: string | null): Promise<string[]> {
    if (!this.embeddings.configurado) return [];
    let vector: number[];
    try {
      [vector] = await this.embeddings.embeber([texto]);
    } catch (error) {
      this.logger.warn(`Búsqueda sin embeddings (sigue por texto): ${(error as Error).message}`);
      return [];
    }
    // Exacta y no por índice: el catálogo de una cuenta es chico, y un índice
    // aproximado global filtrado después por userId devolvería de menos.
    const filas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "Producto" p
      WHERE p."userId" = ${userId} AND p."activo" AND p."embedding" IS NOT NULL
        AND (${categoria}::text IS NULL OR lower(p."categoria") = lower(${categoria}::text))
        AND (p."embedding" <=> ${literalVector(vector)}::vector) <= ${DISTANCIA_MAXIMA}
      ORDER BY p."embedding" <=> ${literalVector(vector)}::vector, p."id"
      LIMIT ${CANDIDATOS}
    `;
    return filas.map((fila) => fila.id);
  }

  /** Carga los productos en el orden de la fusión, con sus variantes activas y el stock visible. */
  private async cargar(userId: string, ids: string[], reservadas: Map<string, number>): Promise<ProductoEncontrado[]> {
    if (ids.length === 0) return [];
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids }, userId, activo: true },
      include: { variantes: { where: { activo: true }, orderBy: { createdAt: 'asc' } } },
    });
    const porId = new Map(productos.map((producto) => [producto.id, producto]));

    return ids.flatMap((id) => {
      const producto = porId.get(id);
      if (!producto || producto.variantes.length === 0) return [];
      return [
        {
          productoId: producto.id,
          codigo: producto.codigo,
          nombre: producto.nombre,
          categoria: producto.categoria,
          descripcion: producto.descripcion,
          variantes: producto.variantes.map((variante) => {
            const reservadasVariante = reservadas.get(variante.id) ?? 0;
            return {
              varianteId: variante.id,
              sku: variante.sku,
              nombre: variante.nombre,
              precioCentavos: variante.precioCentavos,
              hayStock: hayStock(variante, 1, reservadasVariante),
              stock: describirStock(variante, reservadasVariante),
              unidades: unidadesDisponibles(variante, reservadasVariante),
              reservadas: reservadasVariante,
              stockMinimo: variante.stockMinimo,
            };
          }),
        },
      ];
    });
  }
}
