import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { hayStock } from './catalogo.rules.js';
import { DecisionesClient } from './decisiones.client.js';
import { descuentosParaElCliente, mejorDescuento, type DescuentosVigentes } from './descuentos.rules.js';
import { descuentosActivos } from './descuentos.types.js';
import { reservadasPorVariante } from './reservas.js';
import {
  agruparPorCategoria,
  categoriaVisible,
  estadoParaDecidir,
  MAX_CATEGORIAS_SUGERIDAS,
  MAX_OPCIONES_DECISION,
  MAX_PRODUCTOS_LISTADO,
  productosDeCategoria,
  type CategoriaPanorama,
  type ProductoPanorama,
  type ResultadoCatalogo,
} from './sugerencias.rules.js';

const INSTRUCCIONES_CATEGORIAS =
  'The state is what a customer wrote (in Spanish) to an online shop on WhatsApp. Pick the product category ' +
  'this customer is most likely interested in, judging by what they asked, mentioned or are shopping for.';

const INSTRUCCIONES_PRODUCTOS =
  'The state is what a customer wrote (in Spanish) to an online shop on WhatsApp. Pick the product this ' +
  'customer is most likely interested in, judging by what they asked, mentioned or are shopping for.';

const NINGUNA = 'The customer gave no hint about what they want.';

/**
 * El "¿qué tenés?" del asistente de ventas (`ver_catalogo`). Lee el catálogo
 * con stock de UNA cuenta y decide qué mostrar (sugerencias.rules.ts). Cuando
 * hay que elegir, ordena con Jev según lo que escribió el cliente; si Jev no
 * está o falla, sigue con el orden determinista y el cliente no lo nota.
 */
@Injectable()
export class SugerenciasService {
  private readonly logger = new Logger(SugerenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly decisiones: DecisionesClient,
  ) {}

  async verCatalogo(userId: string, mensajesDelCliente: string[], categoria?: string): Promise<ResultadoCatalogo> {
    const productos = await this.panorama(userId);
    if (productos.length === 0) return { tipo: 'vacio' };
    const estado = estadoParaDecidir(mensajesDelCliente);

    const categorias = agruparPorCategoria(productos);
    const pedida = categoria?.trim();
    if (pedida) {
      const deLaCategoria = productosDeCategoria(productos, pedida);
      if (deLaCategoria.length > 0) {
        return { tipo: 'listado', productos: deLaCategoria, categoria: categoriaVisible(deLaCategoria[0]), restantes: 0 };
      }
      // No hay categorías cargadas: no hay a qué filtrar, se sigue como sin categoría.
      if (categorias.length > 0) {
        const sugeridas = await this.ordenarCategorias(categorias, estado);
        return {
          tipo: 'categoria_sin_productos',
          categoria: pedida,
          categorias: sugeridas.slice(0, MAX_CATEGORIAS_SUGERIDAS),
          restantes: Math.max(sugeridas.length - MAX_CATEGORIAS_SUGERIDAS, 0),
        };
      }
    }

    if (productos.length <= MAX_PRODUCTOS_LISTADO) {
      return { tipo: 'listado', productos, categoria: null, restantes: 0 };
    }
    if (categorias.length > 0) {
      const sugeridas = await this.ordenarCategorias(categorias, estado);
      return {
        tipo: 'categorias',
        categorias: sugeridas.slice(0, MAX_CATEGORIAS_SUGERIDAS),
        restantes: Math.max(sugeridas.length - MAX_CATEGORIAS_SUGERIDAS, 0),
        totalProductos: productos.length,
      };
    }
    const elegidos = await this.ordenarProductos(productos, estado);
    return {
      tipo: 'listado',
      productos: elegidos.slice(0, MAX_PRODUCTOS_LISTADO),
      categoria: null,
      restantes: productos.length - MAX_PRODUCTOS_LISTADO,
    };
  }

  /**
   * Los productos activos con al menos una variante con stock (descontadas
   * las reservas vigentes), con el precio de la más barata que se puede
   * vender. Del más nuevo al más viejo: es el orden determinista.
   */
  async panorama(userId: string): Promise<ProductoPanorama[]> {
    const { productos, descuentos, ahora } = await this.conStock(userId);
    return productos.flatMap((producto) => {
      const precios = producto.preciosConStock
        .map((precio) => {
          const descuento = mejorDescuento(descuentos, producto, precio, ahora);
          return { final: descuento?.precioFinalCentavos ?? precio, descuento };
        })
        .sort((a, b) => a.final - b.final);
      if (precios.length === 0) return [];
      const desde = precios[0].final;
      return [
        {
          productoId: producto.id,
          nombre: producto.nombre,
          categoria: producto.categoria,
          descripcion: producto.descripcion,
          precioDesdeCentavos: desde,
          variosPrecios: precios.some((precio) => precio.final !== desde),
          descuento: precios[0].descuento?.etiqueta ?? null,
        },
      ];
    });
  }

  /**
   * `ver_descuentos`: todas las promos y los productos con descuento que hoy
   * puede aprovechar un cliente (descuentosParaElCliente), sobre el mismo
   * catálogo con stock que `ver_catalogo`.
   */
  async descuentosVigentes(userId: string): Promise<DescuentosVigentes> {
    // Lo común es no tener ninguno: sin descuentos activos no hace falta leer el catálogo.
    if ((await this.prisma.descuento.count({ where: { userId, activo: true } })) === 0) {
      return { promociones: [], productos: [], restantes: 0 };
    }
    const { productos, descuentos, ahora } = await this.conStock(userId);
    return descuentosParaElCliente(descuentos, productos, ahora);
  }

  /** Los productos activos con los precios de lista de sus variantes con stock, y los descuentos que pueden tocarles. */
  private async conStock(userId: string) {
    const productos = await this.prisma.producto.findMany({
      where: { userId, activo: true },
      select: {
        id: true,
        nombre: true,
        categoria: true,
        descripcion: true,
        variantes: {
          where: { activo: true },
          select: { id: true, precioCentavos: true, stock: true, disponible: true, activo: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const descuentos = await descuentosActivos(
      this.prisma,
      userId,
      productos.map((producto) => producto.id),
    );
    const reservadas = await reservadasPorVariante(
      this.prisma,
      productos.flatMap((producto) => producto.variantes.map((variante) => variante.id)),
    );
    return {
      productos: productos.map(({ variantes, ...producto }) => ({
        ...producto,
        preciosConStock: variantes
          .filter((variante) => hayStock(variante, 1, reservadas.get(variante.id) ?? 0))
          .map((variante) => variante.precioCentavos),
      })),
      descuentos,
      ahora: new Date(),
    };
  }

  private async ordenarCategorias(categorias: CategoriaPanorama[], estado: string): Promise<CategoriaPanorama[]> {
    const candidatas = categorias.slice(0, MAX_OPCIONES_DECISION);
    const opciones = Object.fromEntries(
      candidatas.map((categoria, indice) => [`c${indice}`, `Category ${JSON.stringify(categoria.nombre)}`]),
    );
    const orden = await this.ordenar(opciones, INSTRUCCIONES_CATEGORIAS, estado);
    if (!orden) return categorias;
    return [...orden.map((id) => candidatas[Number(id.slice(1))]), ...categorias.slice(MAX_OPCIONES_DECISION)];
  }

  private async ordenarProductos(productos: ProductoPanorama[], estado: string): Promise<ProductoPanorama[]> {
    const candidatos = productos.slice(0, MAX_OPCIONES_DECISION);
    const opciones = Object.fromEntries(
      candidatos.map((producto, indice) => [
        `p${indice}`,
        `Product ${JSON.stringify(producto.nombre)}` +
          (producto.descripcion ? `: ${JSON.stringify(producto.descripcion.slice(0, 120))}` : ''),
      ]),
    );
    const orden = await this.ordenar(opciones, INSTRUCCIONES_PRODUCTOS, estado);
    if (!orden) return productos;
    return [...orden.map((id) => candidatos[Number(id.slice(1))]), ...productos.slice(MAX_OPCIONES_DECISION)];
  }

  /** null = quedarse con el orden determinista (sin charla, sin Jev, o Jev falló). */
  private async ordenar(opciones: Record<string, string>, instrucciones: string, estado: string): Promise<string[] | null> {
    if (!estado || !this.decisiones.configurado) return null;
    try {
      return await this.decisiones.ordenar({ estado, instrucciones, opciones, ninguna: NINGUNA });
    } catch (error) {
      // error y no warn: que llegue a Sentry, porque si Jev rechaza el pedido
      // (modelo dado de baja, parámetro nuevo) las sugerencias pierden el criterio
      // sin que nadie lo note. Sin el estado: es lo que escribió el cliente.
      this.logger.error(`Sugerencias sin Jev (sigue el orden determinista): ${(error as Error).message}`);
      return null;
    }
  }
}
