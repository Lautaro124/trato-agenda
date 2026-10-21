import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Producto } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  agruparFilasImportacion,
  normalizarTexto,
  skuPorDefecto,
  textoBusquedaDe,
  type Moneda,
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
  problemaDelProducto,
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
  /** undefined no la toca: uno nuevo queda en pesos (el default de la columna). */
  moneda?: Moneda;
  variantes: VarianteImportada[];
  /** null lo borra; undefined (la importación) no lo toca. */
  descuento?: DescuentoAGuardar | null;
  /** Las preguntas del producto a medida. Igual que el descuento: null la borra, undefined no la toca. */
  solicitud?: SolicitudADemanda | null;
  /** El precio "desde" de un producto a medida; undefined no lo toca. */
  precioReferenciaCentavos?: number | null;
  /** Los materiales de un producto a medida; undefined (la importación) no los toca. */
  materiales?: string[];
  /** La receta de cotización (LAU-26): null la borra, undefined no la toca. Ya validada contra los insumos. */
  receta?: Receta | null;
  politicaCotizacion?: PoliticaCotizacion;
  /** De dónde se importó (LAU-31); undefined no lo toca. */
  origen?: { id: string; url: string };
};

/** Un producto ya revisado en la vista previa de la importación rápida (LAU-31). */
export type ProductoImportadoAGuardar = Pick<GuardarProductoDto, 'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'variantes'> & {
  moneda: Moneda;
  origen: { id: string; url: string };
};

export type ResultadoImportado =
  | { estado: 'creado' | 'actualizado'; productoId: string }
  | { estado: 'salteado'; productoId: string; motivo: string };

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
    const datos = await this.conReceta(userId, desdeDto(dto), dto, null);
    const id = await this.prisma.$transaction((tx) => this.escribir(tx, userId, datos));
    await this.refrescarBusqueda([id]);
    return this.obtener(userId, id);
  }

  async actualizar(userId: string, id: string, dto: GuardarProductoDto): Promise<ProductoPublico> {
    const actual = await this.buscarPropio(userId, id);
    const datos = await this.conReceta(userId, desdeDto(dto), dto, actual);
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
      include: { producto: { select: { solicitud: true } } },
    });
    if (!variante) throw new NotFoundException('No existe esa variante.');
    // Las de un producto a medida son fijas, sin stock: se editan desde el producto, nunca sueltas.
    if (leerSolicitud(variante.producto.solicitud) !== null) {
      throw new ConflictException('Ese producto es a medida: sus versiones se editan desde el producto y no llevan stock.');
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
    const agrupados = agruparFilasImportacion(filas);

    const encontrados = await this.prisma.producto.findMany({
      where: { userId, activo: true, codigo: { in: agrupados.productos.map((producto) => producto.codigo) } },
      select: { codigo: true, solicitud: true },
    });
    const existentes = new Set(encontrados.map((producto) => producto.codigo));
    // Una planilla es una fila por variante con su precio y su stock: no pisa un producto a medida.
    const aMedida = new Set(
      encontrados.filter((producto) => leerSolicitud(producto.solicitud) !== null).map((producto) => producto.codigo),
    );
    const productos = agrupados.productos.filter((producto) => !aMedida.has(producto.codigo));
    const errores = [
      ...agrupados.errores,
      ...agrupados.productos
        .filter((producto) => aMedida.has(producto.codigo))
        .map((producto) => ({
          fila: producto.filas[0],
          mensaje: `el producto ${producto.codigo} es a medida: se edita desde su pantalla, no con la planilla`,
        })),
    ].sort((a, b) => a.fila - b.fila);

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

  /**
   * Guarda un producto de la importación rápida. Lo reconoce por su origen
   * (Producto.origenId) y si no por su código: si ya existe y no se pidió
   * actualizarlo, lo saltea en vez de duplicarlo. Uno dado de baja con ese
   * origen se reactiva. Dos confirmaciones del mismo enlace a la vez chocan
   * en el índice único (userId, origenId) y la segunda queda salteada.
   */
  async guardarImportado(
    userId: string,
    importado: ProductoImportadoAGuardar,
    { actualizar }: { actualizar: boolean },
  ): Promise<ResultadoImportado> {
    // Siempre de stock: la importación no arma productos a medida.
    const datos: ProductoAGuardar = {
      ...desdeDto({ ...importado, solicitud: null }),
      moneda: importado.moneda,
      origen: importado.origen,
      // Lo que la importación no trae no se pisa al actualizar.
      descuento: undefined,
    };
    try {
      const resultado = await this.prisma.$transaction(async (tx): Promise<ResultadoImportado> => {
        const [porOrigen, porCodigo] = await Promise.all([
          tx.producto.findUnique({ where: { userId_origenId: { userId, origenId: importado.origen.id } } }),
          tx.producto.findUnique({ where: { userId_codigo: { userId, codigo: datos.codigo } } }),
        ]);
        if (porOrigen?.activo && !actualizar) {
          return { estado: 'salteado', productoId: porOrigen.id, motivo: 'Ya lo habías importado.' };
        }
        const otroConElCodigo = porCodigo && porCodigo.id !== porOrigen?.id && porCodigo.activo ? porCodigo : null;
        if (otroConElCodigo && (!actualizar || porOrigen)) {
          return { estado: 'salteado', productoId: otroConElCodigo.id, motivo: `Ya hay un producto con el código ${datos.codigo}.` };
        }
        const existente = porOrigen ?? (porCodigo?.activo ? porCodigo : null);
        if (existente && leerSolicitud(existente.solicitud) !== null) {
          throw new ConflictException(`El producto ${existente.codigo} es a medida: no se actualiza con una importación.`);
        }
        const id = await this.escribir(tx, userId, datos, porOrigen?.id ?? existente?.id);
        // Uno dado de baja que vuelve es, para el dueño, uno nuevo.
        return { estado: existente?.activo ? 'actualizado' : 'creado', productoId: id };
      });
      if (resultado.estado !== 'salteado') await this.refrescarBusqueda([resultado.productoId]);
      return resultado;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const otro = await this.prisma.producto.findFirst({
          where: { userId, OR: [{ origenId: importado.origen.id }, { codigo: datos.codigo }] },
          select: { id: true },
        });
        return { estado: 'salteado', productoId: otro?.id ?? '', motivo: 'Ya lo habías importado.' };
      }
      throw error;
    }
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
    const anterior =
      datos.moneda === undefined
        ? null
        : await tx.producto.findUnique({
            where: id ? { id } : { userId_codigo: { userId, codigo: datos.codigo } },
            select: { moneda: true },
          });
    const campos = {
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      categoria: datos.categoria,
      activo: true,
      textoBusqueda,
      ...(datos.moneda !== undefined && { moneda: datos.moneda }),
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
      ...(datos.origen !== undefined && { origenId: datos.origen.id, origenUrl: datos.origen.url, importadoAt: new Date() }),
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
    } else if (datos.descuento === undefined && anterior && anterior.moneda !== datos.moneda) {
      // Un monto fijo guardado en una moneda no vale lo mismo en la otra: se borra en vez de reinterpretarse.
      await tx.descuento.deleteMany({ where: { productoId: producto.id, userId, tipo: 'monto' } });
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
    return { ...datos, receta: receta !== undefined ? receta : datos.receta, politicaCotizacion: politica };
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

/**
 * DTO del formulario → la misma forma que sale de una importación. El
 * formulario manda el producto entero: con `solicitud` es a medida, sin ella
 * es de stock, y lo del otro tipo se borra (un producto puede cambiar de tipo).
 */
export function desdeDto(dto: GuardarProductoDto): ProductoAGuardar {
  const aMedida = dto.solicitud !== undefined && dto.solicitud !== null;
  if (!aMedida && ((dto.receta !== undefined && dto.receta !== null) || (dto.politicaCotizacion ?? 'manual') !== 'manual')) {
    throw new BadRequestException('Un producto de stock no se cotiza: su precio sale de las variantes.');
  }
  const problema = problemaDelProducto({
    moneda: dto.moneda,
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
  const codigo = dto.codigo.trim();
  const variantes = (dto.variantes ?? []).map((variante) => {
    const nombre = (variante.nombre ?? '').trim();
    return {
      sku: (variante.sku ?? '').trim() || skuPorDefecto(codigo, nombre),
      nombre,
      precioCentavos: variante.precioCentavos,
      stock: variante.stock ?? null,
      stockMinimo: variante.stockMinimo ?? null,
      // Una variante fija (a medida) no se agota: se hace cuando la piden.
      disponible: aMedida ? true : (variante.disponible ?? true),
    };
  });
  if (aMedida && variantes.some((variante) => !variante.nombre)) {
    throw new BadRequestException('Poné el nombre de cada versión con precio fijo (por ejemplo "Roble 1,20 m").');
  }
  const skus = new Set(variantes.map((variante) => variante.sku));
  if (skus.size !== variantes.length) {
    throw new BadRequestException('Dos variantes del producto tienen el mismo SKU.');
  }
  const base = {
    codigo,
    nombre: dto.nombre.trim(),
    descripcion: (dto.descripcion ?? '').trim(),
    categoria: dto.categoria?.trim() || null,
    ...(dto.moneda !== undefined && { moneda: dto.moneda }),
    variantes,
  };
  if (!aMedida) {
    return {
      ...base,
      descuento: dto.descuento === undefined ? undefined : dto.descuento && descuentoDesdeDto(dto.descuento),
      solicitud: null,
      precioReferenciaCentavos: null,
      materiales: [],
      receta: null,
      politicaCotizacion: 'manual',
    };
  }
  return {
    ...base,
    // Se cotiza en pesos, como los presupuestos y los costos.
    moneda: 'ARS',
    // Un producto a medida no tiene variantes que descontar: si quedó uno de antes, se borra.
    descuento: null,
    solicitud: solicitudDesdeDto(dto.solicitud as SolicitudDto),
    precioReferenciaCentavos: dto.precioReferenciaCentavos ?? null,
    // Como el precio "desde": en un producto a medida, no mandarlos es no tener.
    materiales: materialesDesdeDto(dto.materiales ?? []),
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

