import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Producto } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  agruparFilasImportacion,
  esIdMercadoLibre,
  normalizarTexto,
  textoBusquedaDe,
  type ErrorDeFila,
  type Moneda,
  type ProductoImportado,
} from './catalogo.rules.js';
import { normalizarCuotasProducto, type CuotasProducto } from './condiciones-pago.rules.js';
import { finDeVigencia, inicioDeVigencia, problemaDeDescuento, type TipoDescuento } from './descuentos.rules.js';
import { descuentosActivos, type DescuentoProductoDto } from './descuentos.types.js';
import { IndexadorService } from './indexador.service.js';
import {
  aProductoPublico,
  type ActualizarStockDto,
  type GuardarProductoDto,
  type ListarProductosQuery,
  type ProductoPublico,
  type ResumenImportacion,
} from './productos.types.js';

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
  precioCentavos: number;
  stock: number | null;
  stockMinimo: number | null;
  disponible: boolean;
  /** null lo borra; undefined (la importación) no lo toca. */
  descuento?: DescuentoAGuardar | null;
  /** Las cuotas, ya validadas (null = en un pago); undefined (la importación) no las toca. */
  cuotas?: CuotasProducto | null;
  /** De dónde se importó (LAU-31); undefined no lo toca. */
  origen?: { id: string; url: string };
};

/** Un producto ya revisado en la vista previa de la importación rápida (LAU-31). */
export type ProductoImportadoAGuardar = Pick<
  GuardarProductoDto,
  'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'precioCentavos' | 'stock'
> & {
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
        include: { descuento: true, imagen: SIN_BYTES },
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
    const datos = desdeDto(dto);
    const id = await this.prisma.$transaction((tx) => this.escribir(tx, userId, datos));
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

  async actualizarStock(userId: string, id: string, dto: ActualizarStockDto): Promise<ProductoPublico> {
    await this.buscarPropio(userId, id);
    await this.prisma.producto.update({
      where: { id },
      data: {
        ...(dto.precioCentavos !== undefined ? { precioCentavos: dto.precioCentavos } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.stockMinimo !== undefined ? { stockMinimo: dto.stockMinimo } : {}),
      },
    });
    return this.obtener(userId, id);
  }

  /**
   * Baja lógica: deja de venderse, pero las ventas que lo nombran siguen
   * intactas. La foto sí se borra, para que no ocupe lugar ni cupo.
   */
  async eliminar(userId: string, id: string): Promise<void> {
    await this.buscarPropio(userId, id);
    await this.prisma.$transaction([
      this.prisma.producto.update({ where: { id }, data: { activo: false } }),
      this.prisma.imagenProducto.deleteMany({ where: { productoId: id, userId } }),
    ]);
  }

  async obtener(userId: string, id: string): Promise<ProductoPublico> {
    const [producto, promociones] = await Promise.all([
      this.prisma.producto.findFirst({
        where: { id, userId },
        include: { descuento: true, imagen: SIN_BYTES },
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
    const reconocidos = await this.reconocerPublicaciones(userId, agrupados.productos);

    const encontrados = await this.prisma.producto.findMany({
      where: { userId, activo: true, codigo: { in: reconocidos.productos.map((producto) => producto.codigo) } },
      select: { codigo: true, descripcion: true, categoria: true },
    });
    const porCodigo = new Map(encontrados.map((producto) => [producto.codigo, producto]));
    // Lo que la planilla no trae (descripción, categoría) queda como estaba; uno nuevo nace vacío.
    const productos = reconocidos.productos.map((producto) => {
      const existente = porCodigo.get(producto.codigo);
      return {
        ...producto,
        descripcion: producto.descripcion ?? existente?.descripcion ?? '',
        categoria: producto.categoria !== undefined ? producto.categoria : (existente?.categoria ?? null),
      };
    });
    const errores = [...agrupados.errores, ...reconocidos.errores].sort((a, b) => a.fila - b.fila);

    const resumen: ResumenImportacion = {
      nuevos: productos.filter((producto) => !porCodigo.has(producto.codigo)).length,
      actualizados: productos.filter((producto) => porCodigo.has(producto.codigo)).length,
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
   * Las publicaciones del export de Mercado Libre (código "MLA…") que no están
   * con ese código pueden ser productos que ya existen con otro: uno importado
   * por enlace como "MLA…-2" (se reconoce por su origen). Esos pasan a usar el
   * código del existente, así se
   * actualizan en vez de duplicarse. Dos publicaciones que caen en el mismo
   * producto no se importan: no se adivina cuál vale.
   */
  private async reconocerPublicaciones(
    userId: string,
    productos: ProductoImportado[],
  ): Promise<{ productos: ProductoImportado[]; errores: ErrorDeFila[] }> {
    const deMercadoLibre = productos.filter((producto) => esIdMercadoLibre(producto.codigo));
    if (deMercadoLibre.length === 0) return { productos, errores: [] };

    const conSuCodigo = new Set(
      (
        await this.prisma.producto.findMany({
          where: { userId, activo: true, codigo: { in: deMercadoLibre.map((producto) => producto.codigo) } },
          select: { codigo: true },
        })
      ).map((producto) => producto.codigo),
    );
    const sinCodigo = deMercadoLibre.filter((producto) => !conSuCodigo.has(producto.codigo));
    if (sinCodigo.length === 0) return { productos, errores: [] };

    const porOrigen = await this.prisma.producto.findMany({
      where: { userId, activo: true, origenId: { in: sinCodigo.map((producto) => `ml:${producto.codigo}`) } },
      select: { codigo: true, origenId: true },
    });

    const reconocidos = productos.map((producto) => {
      if (!sinCodigo.includes(producto)) return producto;
      const codigo = porOrigen.find((existente) => existente.origenId === `ml:${producto.codigo}`)?.codigo;
      return codigo ? { ...producto, codigo } : producto;
    });

    const errores: ErrorDeFila[] = [];
    const vistos = new Map<string, ProductoImportado>();
    const repetidos = new Set<ProductoImportado>();
    for (const producto of reconocidos) {
      const anterior = vistos.get(producto.codigo);
      if (!anterior) {
        vistos.set(producto.codigo, producto);
        continue;
      }
      repetidos.add(anterior).add(producto);
    }
    for (const [indice, producto] of reconocidos.entries()) {
      if (!repetidos.has(producto)) continue;
      errores.push({
        fila: producto.fila,
        mensaje: `la publicación ${productos[indice].codigo} es el mismo producto (${producto.codigo}) que otra fila de la planilla`,
      });
    }
    return { productos: reconocidos.filter((producto) => !repetidos.has(producto)), errores };
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
    const { origen, ...producto } = importado;
    const datos: ProductoAGuardar = {
      ...desdeDto(producto),
      moneda: producto.moneda,
      origen,
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
   * Escribe un producto y devuelve su id.
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
      precioCentavos: datos.precioCentavos,
      stock: datos.stock,
      stockMinimo: datos.stockMinimo,
      disponible: datos.disponible,
      ...(datos.moneda !== undefined && { moneda: datos.moneda }),
      // Sólo si vino: la importación no lo manda y no tiene que pisarlo.
      ...(datos.cuotas !== undefined && { cuotas: datos.cuotas === null ? Prisma.DbNull : datos.cuotas }),
      ...(datos.origen !== undefined && { origenId: datos.origen.id, origenUrl: datos.origen.url, importadoAt: new Date() }),
    };
    const producto = id
      ? await tx.producto.update({ where: { id }, data: campos })
      : await tx.producto.upsert({
          where: { userId_codigo: { userId, codigo: datos.codigo } },
          create: { userId, ...campos },
          update: campos,
        });

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
export function desdeDto(
  dto: Pick<GuardarProductoDto, 'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'moneda' | 'precioCentavos'> &
    Partial<Pick<GuardarProductoDto, 'stock' | 'stockMinimo' | 'disponible' | 'descuento' | 'cuotas'>>,
): ProductoAGuardar {
  return {
    codigo: dto.codigo.trim(),
    nombre: dto.nombre.trim(),
    descripcion: (dto.descripcion ?? '').trim(),
    categoria: dto.categoria?.trim() || null,
    ...(dto.moneda !== undefined && { moneda: dto.moneda }),
    precioCentavos: dto.precioCentavos,
    stock: dto.stock ?? null,
    stockMinimo: dto.stockMinimo ?? null,
    disponible: dto.disponible ?? true,
    descuento: dto.descuento === undefined ? undefined : dto.descuento && descuentoDesdeDto(dto.descuento),
    cuotas: dto.cuotas === undefined ? undefined : cuotasDesdeDto(dto.cuotas, dto.precioCentavos, dto.moneda ?? 'ARS'),
  };
}

/** Las cuotas del formulario, validadas contra el precio y la moneda del mismo formulario. */
function cuotasDesdeDto(entrada: unknown, precioCentavos: number, moneda: Moneda): CuotasProducto | null {
  const resultado = normalizarCuotasProducto(entrada, precioCentavos, moneda);
  if ('error' in resultado) throw new BadRequestException(resultado.error);
  return resultado.cuotas;
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

