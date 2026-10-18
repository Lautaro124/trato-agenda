import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Producto } from '../generated/prisma/client.js';
import { leerModalidad, type ModalidadVenta } from '../agents/modalidad-venta.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  agruparFilasImportacion,
  normalizarTexto,
  skuPorDefecto,
  textoBusquedaDe,
  type VarianteImportada,
} from './catalogo.rules.js';
import { finDeVigencia, inicioDeVigencia, problemaDeDescuento, type TipoDescuento } from './descuentos.rules.js';
import { descuentosActivos, type DescuentoProductoDto } from './descuentos.types.js';
import { IndexadorService } from './indexador.service.js';
import {
  aProductoPublico,
  type ActualizarVarianteDto,
  type GuardarProductoDto,
  type ListarProductosQuery,
  type ProductoPublico,
  type ResumenImportacion,
  type SolicitudDto,
} from './productos.types.js';
import {
  leerSolicitud,
  normalizarMateriales,
  normalizarSolicitud,
  problemaSegunModalidad,
  type SolicitudADemanda,
} from './solicitud.rules.js';
import {
  leerPolitica,
  leerReceta,
  normalizarReceta,
  mapaDeInsumos,
  recetaConContenido,
  type PoliticaCotizacion,
  type Receta,
} from './costos.rules.js';

/** De la foto sólo hace falta saber si está y de cuándo es: nunca traer los bytes a un listado. */
const SIN_BYTES = { select: { updatedAt: true } } as const;

/** Productos por página en el panel. */
export const POR_PAGINA = 25;

/** Productos por transacción al importar: lotes chicos para no pasar el timeout. */
const LOTE_IMPORTACION = 100;

/** Errores que vuelven en la vista previa; el resto sólo se cuenta. */
const MAX_ERRORES_DEVUELTOS = 200;

type DescuentoAGuardar = {
  tipo: TipoDescuento;
  valor: number;
  activo: boolean;
  desde: Date | null;
  hasta: Date | null;
};

type ProductoAGuardar = {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  variantes: VarianteImportada[];
  /** null lo borra; undefined (la importación) no lo toca. */
  descuento?: DescuentoAGuardar | null;
  /** Las preguntas del producto a medida. Igual que el descuento: null la borra, undefined no la toca. */
  solicitud?: SolicitudADemanda | null;
  /** El precio "desde" de un producto a medida; undefined no lo toca. */
  precioReferenciaCentavos?: number | null;
  /** Los materiales de un producto a medida; undefined (la importación, las cuentas con stock) no los toca. */
  materiales?: string[];
  /** La receta de cotización (LAU-26): null la borra, undefined no la toca. Ya validada contra los insumos. */
  receta?: Receta | null;
  politicaCotizacion?: PoliticaCotizacion;
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

    const [total, productos, promociones] = await Promise.all([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        include: { variantes: { orderBy: { createdAt: 'asc' }, include: { imagen: SIN_BYTES } }, descuento: true, imagen: SIN_BYTES },
        orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
      descuentosActivos(this.prisma, userId, []),
    ]);

    const ahora = new Date();
    return {
      productos: productos.map((producto) => aProductoPublico(producto, promociones, ahora)),
      total,
      pagina,
      porPagina: POR_PAGINA,
    };
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
    const datos = await this.conReceta(userId, desdeDto(dto, await this.modalidadDe(userId)), dto, null);
    const id = await this.prisma.$transaction((tx) => this.escribir(tx, userId, datos));
    await this.refrescarBusqueda([id]);
    return this.obtener(userId, id);
  }

  async actualizar(userId: string, id: string, dto: GuardarProductoDto): Promise<ProductoPublico> {
    const actual = await this.buscarPropio(userId, id);
    const datos = await this.conReceta(userId, desdeDto(dto, await this.modalidadDe(userId)), dto, actual);
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
    // A pedido las variantes son fijas, sin stock: se editan desde el producto, nunca sueltas.
    if ((await this.modalidadDe(userId)) === 'pedido') {
      throw new ConflictException('Tu cuenta vende a pedido: las versiones se editan desde el producto y no llevan stock.');
    }

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

  /**
   * Baja lógica: deja de venderse, pero las ventas que lo nombran siguen
   * intactas. Las fotos (la suya y las de sus variantes) sí se borran, para
   * que no ocupen lugar ni cupo.
   */
  async eliminar(userId: string, id: string): Promise<void> {
    await this.buscarPropio(userId, id);
    await this.prisma.$transaction([
      this.prisma.producto.update({ where: { id }, data: { activo: false } }),
      this.prisma.imagenProducto.deleteMany({ where: { productoId: id, userId } }),
      this.prisma.imagenVariante.deleteMany({ where: { userId, variante: { productoId: id } } }),
    ]);
  }

  async obtener(userId: string, id: string): Promise<ProductoPublico> {
    const [producto, promociones] = await Promise.all([
      this.prisma.producto.findFirst({
        where: { id, userId },
        include: { variantes: { orderBy: { createdAt: 'asc' }, include: { imagen: SIN_BYTES } }, descuento: true, imagen: SIN_BYTES },
      }),
      descuentosActivos(this.prisma, userId, []),
    ]);
    if (!producto) throw new NotFoundException('No existe ese producto.');
    return aProductoPublico(producto, promociones);
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
    // Una planilla es una fila por variante con su precio: no sirve para productos a medida.
    if ((await this.modalidadDe(userId)) === 'pedido') {
      throw new ConflictException('En una cuenta a pedido los productos se cargan de a uno.');
    }
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
      // Sólo si vino: la importación no la manda y no tiene que pisarla.
      ...(datos.precioReferenciaCentavos !== undefined && { precioReferenciaCentavos: datos.precioReferenciaCentavos }),
      ...(datos.solicitud !== undefined && {
        solicitud: datos.solicitud === null ? Prisma.DbNull : (datos.solicitud as unknown as Prisma.InputJsonValue),
      }),
      ...(datos.materiales !== undefined && { materiales: datos.materiales }),
      ...(datos.receta !== undefined && {
        receta: datos.receta === null ? Prisma.DbNull : (datos.receta as unknown as Prisma.InputJsonValue),
      }),
      ...(datos.politicaCotizacion !== undefined && { politicaCotizacion: datos.politicaCotizacion }),
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
    const quedan = datos.variantes.map((variante) => variante.sku);
    await tx.variante.updateMany({
      where: { productoId: producto.id, sku: { notIn: quedan } },
      data: { activo: false },
    });
    // La foto de una variante que se fue no ocupa cupo (como la de un producto borrado).
    await tx.imagenVariante.deleteMany({ where: { userId, variante: { productoId: producto.id, sku: { notIn: quedan } } } });

    if (datos.descuento === null) {
      await tx.descuento.deleteMany({ where: { productoId: producto.id, userId } });
    } else if (datos.descuento) {
      await tx.descuento.upsert({
        where: { productoId: producto.id },
        create: { userId, productoId: producto.id, ...datos.descuento },
        update: datos.descuento,
      });
    }
    return producto.id;
  }

  /**
   * La receta y quién cotiza (LAU-26), validadas con lo que sólo sabe la base:
   * que cada renglón use un insumo activo del dueño y que las fórmulas usen
   * las preguntas de número del producto tal como quedan guardadas. Para que
   * el asistente cotice solo hace falta una receta con algo que calcular.
   */
  private async conReceta(
    userId: string,
    datos: ProductoAGuardar,
    dto: GuardarProductoDto,
    actual: Pick<Producto, 'solicitud' | 'receta' | 'politicaCotizacion'> | null,
  ): Promise<ProductoAGuardar> {
    if (dto.receta === undefined && dto.politicaCotizacion === undefined) return datos;
    const solicitud = datos.solicitud !== undefined ? datos.solicitud : leerSolicitud(actual?.solicitud ?? null);
    let receta: Receta | null | undefined = undefined;
    if (dto.receta === null) receta = null;
    else if (dto.receta !== undefined) {
      const insumos = await this.prisma.insumo.findMany({ where: { userId, activo: true } });
      const resultado = normalizarReceta(dto.receta, { solicitud, insumos: mapaDeInsumos(insumos) });
      if ('error' in resultado) throw new BadRequestException(resultado.error);
      receta = resultado.receta;
    }
    const politica = dto.politicaCotizacion ?? leerPolitica(actual?.politicaCotizacion);
    const final = receta !== undefined ? receta : leerReceta(actual?.receta ?? null, solicitud);
    if (politica !== 'manual' && !recetaConContenido(final)) {
      throw new BadRequestException('Para que el asistente cotice, cargá la receta: qué materiales y costos lleva.');
    }
    return { ...datos, receta, politicaCotizacion: politica };
  }

  /** Cómo vende la cuenta: decide qué productos acepta. Sin asistente todavía, con stock. */
  private async modalidadDe(userId: string): Promise<ModalidadVenta> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { modalidadVenta: true } });
    return agent ? leerModalidad(agent) : 'stock';
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
export function desdeDto(dto: GuardarProductoDto, modalidad: ModalidadVenta = 'stock'): ProductoAGuardar {
  if (modalidad !== 'pedido' && ((dto.receta !== undefined && dto.receta !== null) || (dto.politicaCotizacion ?? 'manual') !== 'manual')) {
    throw new BadRequestException('Una cuenta con stock no cotiza: los precios salen de las variantes.');
  }
  const problema = problemaSegunModalidad(modalidad, {
    variantes: dto.variantes?.length ?? 0,
    descuento: dto.descuento,
    solicitud: dto.solicitud,
    precioReferencia: dto.precioReferenciaCentavos,
    materiales: dto.materiales,
    conStock: (dto.variantes ?? []).some(
      (variante) => (variante.stock ?? null) !== null || (variante.stockMinimo ?? null) !== null,
    ),
  });
  if (problema) throw new BadRequestException(problema);
  const aPedido = modalidad === 'pedido';
  const codigo = dto.codigo.trim();
  const variantes = (dto.variantes ?? []).map((variante) => {
    const nombre = (variante.nombre ?? '').trim();
    return {
      sku: (variante.sku ?? '').trim() || skuPorDefecto(codigo, nombre),
      nombre,
      precioCentavos: variante.precioCentavos,
      stock: variante.stock ?? null,
      stockMinimo: variante.stockMinimo ?? null,
      // Una variante fija (a pedido) no se agota: se hace cuando la piden.
      disponible: aPedido ? true : (variante.disponible ?? true),
    };
  });
  if (aPedido && variantes.some((variante) => !variante.nombre)) {
    throw new BadRequestException('Poné el nombre de cada versión con precio fijo (por ejemplo "Roble 1,20 m").');
  }
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
    // A pedido no hay variantes que descontar: si quedó uno de antes, se borra.
    descuento:
      modalidad === 'pedido'
        ? null
        : dto.descuento === undefined
          ? undefined
          : dto.descuento && descuentoDesdeDto(dto.descuento),
    solicitud: dto.solicitud === undefined ? undefined : dto.solicitud && solicitudDesdeDto(dto.solicitud),
    precioReferenciaCentavos: modalidad === 'pedido' ? (dto.precioReferenciaCentavos ?? null) : undefined,
    // Como el precio "desde": en un producto a medida, no mandarlos es no tener.
    materiales: modalidad === 'pedido' ? materialesDesdeDto(dto.materiales ?? []) : undefined,
  };
}

/** Los materiales del producto a medida → lo que se guarda, o un 400 con el motivo. */
function materialesDesdeDto(lista: string[]): string[] {
  const resultado = normalizarMateriales(lista);
  if ('error' in resultado) throw new BadRequestException(resultado.error);
  return resultado.materiales;
}

/** Las preguntas del producto a medida → lo que se guarda, o un 400 con el motivo. */
function solicitudDesdeDto(dto: SolicitudDto): SolicitudADemanda {
  const resultado = normalizarSolicitud(dto);
  if ('error' in resultado) throw new BadRequestException(resultado.error);
  return resultado.solicitud;
}

/** El descuento del formulario (o de una promo) → lo que se guarda, con las fechas como instantes. */
export function descuentoDesdeDto(dto: DescuentoProductoDto): DescuentoAGuardar {
  const problema = problemaDeDescuento(dto);
  if (problema) throw new BadRequestException(problema);
  return {
    tipo: dto.tipo,
    valor: dto.valor,
    activo: dto.activo ?? true,
    desde: dto.desde ? inicioDeVigencia(dto.desde) : null,
    hasta: dto.hasta ? finDeVigencia(dto.hasta) : null,
  };
}

