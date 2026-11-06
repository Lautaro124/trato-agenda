import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Descuento, Producto } from '../generated/prisma/client.js';
import { hashTexto, LARGOS, monedaDe, MONEDAS, type ErrorDeFila, type Moneda, MAX_FILAS_IMPORTACION, PLAZO_ENTREGA_MAX_DIAS, PRECIO_MAX_PESOS, STOCK_MAX } from './catalogo.rules.js';
import { leerCuotasProducto, type CuotasProducto } from './condiciones-pago.rules.js';
import { MAX_PREGUNTAS_POR_PRODUCTO, leerPreguntas, type PreguntaProducto } from './preguntas-producto.rules.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';
import {
  aDescuentoDeProducto,
  aDescuentoPublico,
  DescuentoProductoDto,
  type DescuentoDeProducto,
  type DescuentoPublico,
} from './descuentos.types.js';

/** Body de `POST /productos` y `PUT /productos/:id`. */
export class GuardarProductoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(LARGOS.codigo)
  codigo!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(LARGOS.nombre)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGOS.descripcion)
  descripcion?: string;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(LARGOS.categoria)
  categoria?: string | null;

  /** Moneda del precio. Ausente no la toca (uno nuevo queda en pesos). */
  @IsOptional()
  @IsIn(MONEDAS)
  moneda?: Moneda;

  /**
   * Las cuotas (CuotasProducto; null = en un pago; ausente no las toca). La
   * forma la valida normalizarCuotasProducto contra el precio y la moneda.
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsObject()
  cuotas?: Record<string, unknown> | null;

  /**
   * Las preguntas al pedir (PreguntaProducto[]; null o [] = ninguna; ausente
   * no las toca). La forma la valida normalizarPreguntas.
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsArray()
  @ArrayMaxSize(MAX_PREGUNTAS_POR_PRODUCTO)
  @IsObject({ each: true })
  preguntas?: Array<Record<string, unknown>> | null;

  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX_PESOS * 100)
  precioCentavos!: number;

  /** null = a demanda (sin control de cantidad). */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stock?: number | null;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  /**
   * A demanda: en cuántos días se entrega. Con `stock` se ignora (queda en
   * null); ausente no lo toca.
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(1)
  @Max(PLAZO_ENTREGA_MAX_DIAS)
  plazoEntregaDias?: number | null;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stockMinimo?: number | null;

  /**
   * El descuento propio del producto. null lo borra; ausente no lo toca (así
   * un cliente viejo que no lo manda no se lo pisa).
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @ValidateNested()
  @Type(() => DescuentoProductoDto)
  descuento?: DescuentoProductoDto | null;
}

/** Body de `PATCH /productos/:id/stock`: la edición rápida de precio y stock desde la tarjeta. */
export class ActualizarStockDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX_PESOS * 100)
  precioCentavos?: number;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stock?: number | null;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stockMinimo?: number | null;
}

/**
 * Body de `POST /productos/importar`. La web parsea el CSV/XLSX y manda las
 * filas tal cual (encabezado → valor); la validación de cada celda es de
 * catalogo.rules.ts, no de class-validator, para poder devolver los errores
 * por fila en vez de un 400 genérico.
 */
export class ImportarProductosDto {
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_IMPORTACION)
  @IsObject({ each: true })
  filas!: Array<Record<string, unknown>>;

  /** false = sólo vista previa, no escribe nada. */
  @IsBoolean()
  confirmar!: boolean;
}

export class ListarProductosQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGOS.categoria)
  categoria?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  pagina?: number;
}

export type ProductoPublico = Pick<
  Producto,
  | 'id'
  | 'codigo'
  | 'nombre'
  | 'descripcion'
  | 'categoria'
  | 'activo'
  | 'updatedAt'
  | 'precioCentavos'
  | 'stock'
  | 'disponible'
  | 'stockMinimo'
  | 'plazoEntregaDias'
> & {
  moneda: Moneda;
  /** Lo que paga hoy el cliente: `precioCentavos` menos el mejor descuento vigente. */
  precioFinalCentavos: number;
  /** El descuento que hoy le toca (el propio o una promo). */
  descuentoAplicado: DescuentoDeProducto | null;
  /** El descuento propio del producto (el del formulario), vigente o no. */
  descuento: DescuentoPublico | null;
  /** true cuando el embedding está al día: el asistente ya lo encuentra por significado. */
  indexado: boolean;
  /** Cuándo se subió la foto principal (null = sin fotos). La web la usa también para no mostrar una cacheada vieja. */
  imagenActualizada: Date | null;
  /** Todas las fotos, la principal primero. */
  imagenes: Array<{ id: string; actualizada: Date }>;
  /** Las cuotas vigentes (null = en un pago). */
  cuotas: CuotasProducto | null;
  /** Lo que el asistente le pregunta al cliente al pedirlo (null = nada). */
  preguntas: PreguntaProducto[] | null;
};

/**
 * `promociones` son las promos de catálogo y de categoría de la cuenta (las
 * de `descuentosActivos`): con ellas y el descuento propio se calcula el
 * precio final.
 */
export function aProductoPublico(
  producto: Producto & { descuento?: Descuento | null; imagenes?: Array<{ id: string; updatedAt: Date }> },
  promociones: DescuentoParaAplicar[] = [],
  ahora: Date = new Date(),
): ProductoPublico {
  const candidatos = [
    ...(producto.descuento ? [producto.descuento] : []),
    ...promociones.filter((promocion) => promocion.productoId === null),
  ];
  const aplicado = mejorDescuento(candidatos, producto, producto.precioCentavos, ahora);
  return {
    id: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria: producto.categoria,
    moneda: monedaDe(producto.moneda),
    activo: producto.activo,
    updatedAt: producto.updatedAt,
    precioCentavos: producto.precioCentavos,
    stock: producto.stock,
    disponible: producto.disponible,
    stockMinimo: producto.stockMinimo,
    plazoEntregaDias: producto.plazoEntregaDias,
    precioFinalCentavos: aplicado?.precioFinalCentavos ?? producto.precioCentavos,
    descuentoAplicado: aDescuentoDeProducto(aplicado),
    indexado: producto.embeddingHash === hashTexto(producto.textoBusqueda),
    descuento: producto.descuento ? aDescuentoPublico(producto.descuento, producto.moneda) : null,
    imagenActualizada: producto.imagenes?.[0]?.updatedAt ?? null,
    imagenes: (producto.imagenes ?? []).map((foto) => ({ id: foto.id, actualizada: foto.updatedAt })),
    cuotas: leerCuotasProducto(producto.cuotas, producto.precioCentavos, producto.moneda),
    preguntas: leerPreguntas(producto.preguntasPedido),
  };
}

export type ResumenImportacion = {
  nuevos: number;
  actualizados: number;
  errores: ErrorDeFila[];
  /** Cuántos errores hubo en total; `errores` trae como mucho los primeros 200. */
  totalErrores: number;
  confirmado: boolean;
};
