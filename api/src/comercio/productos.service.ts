import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Producto } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  agruparFilasImportacion,
  normalizarTexto,
  skuPorDefecto,
  textoBusquedaDe,
  type VarianteImportada,
} from './catalogo.rules.js';
import { IndexadorService } from './indexador.service.js';
import {
  aProductoPublico,
  type ActualizarVarianteDto,
  type GuardarProductoDto,
  type ListarProductosQuery,
  type ProductoPublico,
  type ResumenImportacion,
} from './productos.types.js';

/** Productos por página en el panel. */
export const POR_PAGINA = 25;

/** Productos por transacción al importar: lotes chicos para no pasar el timeout. */
const LOTE_IMPORTACION = 100;

/** Errores que vuelven en la vista previa; el resto sólo se cuenta. */
const MAX_ERRORES_DEVUELTOS = 200;

type ProductoAGuardar = {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  variantes: VarianteImportada[];
};

type Tx = Prisma.TransactionClient;

export type ListadoProductos = {
  productos: ProductoPublico[];
  total: number;
  pagina: number;
  porPagina: number;
};

/**
 * Alta, edición, baja e importación del catálogo. Toda escritura de un
 * producto pasa por `escribir`, que mantiene al día `textoBusqueda` y el
 * tsvector, y después le avisa al indexador que hay embeddings por recalcular.
 */
@Injectable()
export class ProductosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexador: IndexadorService,
  ) {}

  async listar(userId: string, query: ListarProductosQuery): Promise<ListadoProductos> {
    const pagina = query.pagina ?? 1;
    const consulta = normalizarTexto(query.q ?? '');
    const where: Prisma.ProductoWhereInput = {
      userId,
      activo: true,
      ...(query.categoria ? { categoria: { equals: query.categoria, mode: 'insensitive' } } : {}),
      // `textoBusqueda` ya está normalizado: un contains sobre él encuentra
      // "cafe" en "Café" y lo resuelve el índice de trigramas.
      ...(consulta ? { textoBusqueda: { contains: consulta } } : {}),
    };

    const [total, productos] = await Promise.all([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        include: { variantes: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
    ]);

    return { productos: productos.map(aProductoPublico), total, pagina, porPagina: POR_PAGINA };
  }

  async categorias(userId: string): Promise<Array<{ nombre: string; cantidad: number }>> {
    const grupos = await this.prisma.producto.groupBy({
      by: ['categoria'],
      where: { userId, activo: true, categoria: { not: null } },
      _count: { _all: true },
      orderBy: { categoria: 'asc' },
    });
    return grupos.map((grupo) => ({ nombre: grupo.categoria as string, cantidad: grupo._count._all }));
  }

  async crear(userId: string, dto: GuardarProductoDto): Promise<ProductoPublico> {
    const existente = await this.prisma.producto.findUnique({
      where: { userId_codigo: { userId, codigo: dto.codigo.trim() } },
    });
    // Uno dado de baja con el mismo código se reactiva con los datos nuevos.
    if (existente?.activo) {
      throw new ConflictException(`Ya hay un producto con el código ${dto.codigo.trim()}.`);
    }
    const id = await this.prisma.$transaction((tx) => this.escribir(tx, userId, desdeDto(dto)));
    await this.refrescarBusqueda([id]);
    return this.obtener(userId, id);
  }

  async actualizar(userId: string, id: string, dto: GuardarProductoDto): Promise<ProductoPublico> {
    const actual = await this.buscarPropio(userId, id);
    const datos = desdeDto(dto);
    if (datos.codigo !== actual.codigo) {
      const otro = await this.prisma.producto.findUnique({
        where: { userId_codigo: { userId, codigo: datos.codigo } },
      });
      if (otro) throw new ConflictException(`Ya hay un producto con el código ${datos.codigo}.`);
    }
    await this.prisma.$transaction((tx) => this.escribir(tx, userId, datos, id));
    await this.refrescarBusqueda([id]);
    return this.obtener(userId, id);
  }

  async actualizarVariante(userId: string, varianteId: string, dto: ActualizarVarianteDto): Promise<ProductoPublico> {
    const variante = await this.prisma.variante.findFirst({
      where: { id: varianteId, activo: true, producto: { userId, activo: true } },
    });
    if (!variante) throw new NotFoundException('No existe esa variante.');

    await this.prisma.variante.update({
      where: { id: varianteId },
      data: {
        ...(dto.precioCentavos !== undefined ? { precioCentavos: dto.precioCentavos } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.stockMinimo !== undefined ? { stockMinimo: dto.stockMinimo } : {}),
      },
    });
    return this.obtener(userId, variante.productoId);
  }

  /** Baja lógica: deja de venderse, pero las ventas que lo nombran siguen intactas. */
  async eliminar(userId: string, id: string): Promise<void> {
    await this.buscarPropio(userId, id);
    await this.prisma.producto.update({ where: { id }, data: { activo: false } });
  }

  async obtener(userId: string, id: string): Promise<ProductoPublico> {
    const producto = await this.prisma.producto.findFirst({
      where: { id, userId },
      include: { variantes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!producto) throw new NotFoundException('No existe ese producto.');
    return aProductoPublico(producto);
  }

  /**
   * Importación en dos pasos: con `confirmar=false` sólo cuenta qué pasaría;
   * con `true` escribe los productos válidos, en lotes. Los productos del
   * catálogo que no están en el archivo no se tocan.
   */
  async importar(
    userId: string,
    filas: Array<Record<string, unknown>>,
    confirmar: boolean,
  ): Promise<ResumenImportacion> {
    const { productos, errores } = agruparFilasImportacion(filas);

    const existentes = new Set(
      (
        await this.prisma.producto.findMany({
          where: { userId, activo: true, codigo: { in: productos.map((producto) => producto.codigo) } },
          select: { codigo: true },
        })
      ).map((producto) => producto.codigo),
    );

    const resumen: ResumenImportacion = {
      nuevos: productos.filter((producto) => !existentes.has(producto.codigo)).length,
      actualizados: productos.filter((producto) => existentes.has(producto.codigo)).length,
      variantes: productos.reduce((suma, producto) => suma + producto.variantes.length, 0),
      errores: errores.slice(0, MAX_ERRORES_DEVUELTOS),
      totalErrores: errores.length,
      confirmado: false,
    };
    if (!confirmar || productos.length === 0) return resumen;

    for (let desde = 0; desde < productos.length; desde += LOTE_IMPORTACION) {
      const lote = productos.slice(desde, desde + LOTE_IMPORTACION);
      const ids = await this.prisma.$transaction(
        async (tx) => {
          const escritos: string[] = [];
          for (const producto of lote) escritos.push(await this.escribir(tx, userId, producto));
          return escritos;
        },
        { timeout: 60_000 },
      );
      await this.refrescarBusqueda(ids, false);
    }
    this.indexador.programar();
    return { ...resumen, confirmado: true };
  }

  private async buscarPropio(userId: string, id: string): Promise<Producto> {
    const producto = await this.prisma.producto.findFirst({ where: { id, userId, activo: true } });
    if (!producto) throw new NotFoundException('No existe ese producto.');
    return producto;
  }

  /**
   * Escribe un producto con sus variantes y devuelve su id. Las variantes que
   * ya no vienen se desactivan en vez de borrarse: puede haber ventas que las
   * nombran.
   */
  private async escribir(tx: Tx, userId: string, datos: ProductoAGuardar, id?: string): Promise<string> {
    const textoBusqueda = textoBusquedaDe(datos);
    const campos = {
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      categoria: datos.categoria,
      activo: true,
      textoBusqueda,
    };
    const producto = id
      ? await tx.producto.update({ where: { id }, data: campos })
      : await tx.producto.upsert({
          where: { userId_codigo: { userId, codigo: datos.codigo } },
          create: { userId, ...campos },
          update: campos,
        });

    for (const variante of datos.variantes) {
      const valores = {
        nombre: variante.nombre,
        precioCentavos: variante.precioCentavos,
        stock: variante.stock,
        stockMinimo: variante.stockMinimo,
        disponible: variante.disponible,
        activo: true,
      };
      await tx.variante.upsert({
        where: { productoId_sku: { productoId: producto.id, sku: variante.sku } },
        create: { productoId: producto.id, sku: variante.sku, ...valores },
        update: valores,
      });
    }
    await tx.variante.updateMany({
      where: { productoId: producto.id, sku: { notIn: datos.variantes.map((variante) => variante.sku) } },
      data: { activo: false },
    });
    return producto.id;
  }

  /**
   * `busqueda` es un tsvector que Prisma no sabe escribir: se recalcula en SQL
   * desde `textoBusqueda`. Después se le avisa al indexador (salvo en medio de
   * una importación, que avisa una sola vez al final).
   */
  private async refrescarBusqueda(ids: string[], programarIndexador = true): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.$executeRaw`
      UPDATE "Producto" SET "busqueda" = to_tsvector('spanish', "textoBusqueda") WHERE "id" = ANY(${ids})
    `;
    if (programarIndexador) this.indexador.programar();
  }
}

/** DTO del formulario → la misma forma que sale de una importación. */
export function desdeDto(dto: GuardarProductoDto): ProductoAGuardar {
  const codigo = dto.codigo.trim();
  const variantes = dto.variantes.map((variante) => {
    const nombre = (variante.nombre ?? '').trim();
    return {
      sku: (variante.sku ?? '').trim() || skuPorDefecto(codigo, nombre),
      nombre,
      precioCentavos: variante.precioCentavos,
      stock: variante.stock ?? null,
      stockMinimo: variante.stockMinimo ?? null,
      disponible: variante.disponible ?? true,
    };
  });
  const skus = new Set(variantes.map((variante) => variante.sku));
  if (skus.size !== variantes.length) {
    throw new BadRequestException('Dos variantes del producto tienen el mismo SKU.');
  }
  return {
    codigo,
    nombre: dto.nombre.trim(),
    descripcion: (dto.descripcion ?? '').trim(),
    categoria: dto.categoria?.trim() || null,
    variantes,
  };
}

