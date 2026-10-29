import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import type { Descuento, Producto, Variante } from '../generated/prisma/client.js';
import { hashTexto, LARGOS, monedaDe, MONEDAS, type ErrorDeFila, type Moneda, MAX_FILAS_IMPORTACION, MAX_VARIANTES, PRECIO_MAX_PESOS, STOCK_MAX } from './catalogo.rules.js';
import { MAX_CUOTAS } from './condiciones-pago.rules.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';
import { leerPolitica, leerReceta, POLITICAS_COTIZACION, type PoliticaCotizacion, type Receta } from './costos.rules.js';
import {
  LARGO_MAX_OPCION,
  LARGO_MAX_MATERIAL,
  MAX_MATERIALES,
  LARGO_MAX_PREGUNTA,
  LARGO_MAX_UNIDAD_PREGUNTA,
  leerSolicitud,
  MAX_OPCIONES,
  MAX_PREGUNTAS,
  SOBRE_PREGUNTA,
  type SobrePregunta,
  type SolicitudADemanda,
} from './solicitud.rules.js';
import {
  aDescuentoDeVariante,
  aDescuentoPublico,
  DescuentoProductoDto,
  type DescuentoDeVariante,
  type DescuentoPublico,
} from './descuentos.types.js';

export class VarianteDto {
  /** Vacío = se deriva del código del producto y el nombre de la variante. */
  @IsOptional()
  @IsString()
  @MaxLength(LARGOS.sku)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGOS.variante)
  nombre?: string;

  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX_PESOS * 100)
  precioCentavos!: number;

  /** null = sin control de cantidad. */
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

export class NumeroDePreguntaDto {
  @IsString()
  @MaxLength(30)
  variable!: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_UNIDAD_PREGUNTA)
  unidad?: string;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  min?: number | null;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  max?: number | null;
}

/** Una pregunta del producto a medida. Las reglas entre campos están en solicitud.rules.ts. */
export class PreguntaSolicitudDto {
  @IsString()
  @MaxLength(LARGO_MAX_PREGUNTA)
  texto!: string;

  /** Quedó de la primera versión: sin él, la pregunta es sobre lo que el cliente pide. */
  @IsOptional()
  @IsIn(SOBRE_PREGUNTA)
  sobre?: SobrePregunta;

  @IsArray()
  @ArrayMaxSize(MAX_OPCIONES)
  @IsString({ each: true })
  @MaxLength(LARGO_MAX_OPCION, { each: true })
  opciones!: string[];

  @IsBoolean()
  textoLibre!: boolean;

  @IsBoolean()
  obligatoria!: boolean;

  /** Pregunta de número (LAU-26): su respuesta es un dato de la receta. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @ValidateNested()
  @Type(() => NumeroDePreguntaDto)
  numero?: NumeroDePreguntaDto | null;
}

export class SolicitudDto {
  @IsArray()
  @ArrayMaxSize(MAX_PREGUNTAS)
  @ValidateNested({ each: true })
  @Type(() => PreguntaSolicitudDto)
  preguntas!: PreguntaSolicitudDto[];
}

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

  /** Moneda de los precios de sus variantes. Ausente no la toca (uno nuevo queda en pesos). */
  @IsOptional()
  @IsIn(MONEDAS)
  moneda?: Moneda;

  /** Hasta cuántas cuotas se vende (1 = sólo en un pago). null = sin tope; ausente no lo toca. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_CUOTAS)
  cuotasMax?: number | null;

  /** Obligatorias (al menos una) en una cuenta con stock; un producto a medida no lleva. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VARIANTES)
  @ValidateNested({ each: true })
  @Type(() => VarianteDto)
  variantes?: VarianteDto[];

  /** Precio "desde" de un producto a medida. null = sin precio de referencia. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(1)
  @Max(PRECIO_MAX_PESOS * 100)
  precioReferenciaCentavos?: number | null;

  /**
   * El descuento propio del producto. null lo borra; ausente no lo toca (así
   * un cliente viejo que no lo manda no se lo pisa).
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @ValidateNested()
  @Type(() => DescuentoProductoDto)
  descuento?: DescuentoProductoDto | null;

  /** Producto a medida: sus preguntas. Igual que `descuento`: null la borra, ausente no la toca. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @ValidateNested()
  @Type(() => SolicitudDto)
  solicitud?: SolicitudDto | null;

  /** Producto a medida: con qué materiales se hace. Ausente no los toca; [] los borra. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MATERIALES)
  @IsString({ each: true })
  @MaxLength(LARGO_MAX_MATERIAL, { each: true })
  materiales?: string[];

  /**
   * Producto a medida (LAU-26): la receta de cotización. Su forma la valida
   * costos.rules.ts contra los insumos del dueño. null la borra, ausente no la toca.
   */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsObject()
  receta?: Record<string, unknown> | null;

  /** Quién cotiza este producto. Ausente no lo toca. */
  @IsOptional()
  @IsIn(POLITICAS_COTIZACION)
  politicaCotizacion?: PoliticaCotizacion;
}

/** Body de `PATCH /productos/variantes/:id`: la edición rápida desde la tabla. */
export class ActualizarVarianteDto {
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

export type VariantePublica = Pick<
  Variante,
  'id' | 'sku' | 'nombre' | 'precioCentavos' | 'stock' | 'disponible' | 'stockMinimo' | 'activo'
> & {
  /** Lo que paga hoy el cliente: `precioCentavos` menos el mejor descuento vigente. */
  precioFinalCentavos: number;
  descuento: DescuentoDeVariante | null;
  /** Cuándo se subió su foto propia (sólo variantes fijas de un producto a medida; null = sin foto). */
  imagenActualizada: Date | null;
};

export type ProductoPublico = Pick<
  Producto,
  'id' | 'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'activo' | 'updatedAt'
> & {
  moneda: Moneda;
  variantes: VariantePublica[];
  /** El descuento propio del producto (el del formulario), vigente o no. */
  descuento: DescuentoPublico | null;
  /** true cuando el embedding está al día: el asistente ya lo encuentra por significado. */
  indexado: boolean;
  /** Cuándo se subió la foto (null = sin foto). La web la usa también para no mostrar una cacheada vieja. */
  imagenActualizada: Date | null;
  /** Las preguntas del producto a medida (null = no se hace a medida). */
  solicitud: SolicitudADemanda | null;
  /** Precio "desde" de un producto a medida, si el dueño puso uno. */
  precioReferenciaCentavos: number | null;
  /** Con qué materiales se hace el producto a medida ([] = no los cargó). */
  materiales: string[];
  /** Hasta cuántas cuotas se vende (1 = sólo en un pago; null = con todos los planes). */
  cuotasMax: number | null;
  /** La receta de cotización (null = no tiene: lo cotiza el dueño). */
  receta: Receta | null;
  politicaCotizacion: PoliticaCotizacion;
};

/**
 * `promociones` son las promos de catálogo y de categoría de la cuenta (las
 * de `descuentosActivos`): con ellas y el descuento propio se calcula el
 * precio final de cada variante.
 */
export function aProductoPublico(
  producto: Producto & {
    variantes: Array<Variante & { imagen?: { updatedAt: Date } | null }>;
    descuento?: Descuento | null;
    imagen?: { updatedAt: Date } | null;
  },
  promociones: DescuentoParaAplicar[] = [],
  ahora: Date = new Date(),
): ProductoPublico {
  // Un producto a medida no lleva descuento: sus variantes fijas valen lo que dicen.
  const candidatos = leerSolicitud(producto.solicitud)
    ? []
    : [...(producto.descuento ? [producto.descuento] : []), ...promociones.filter((promocion) => promocion.productoId === null)];
  return {
    id: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria: producto.categoria,
    moneda: monedaDe(producto.moneda),
    activo: producto.activo,
    updatedAt: producto.updatedAt,
    indexado: producto.embeddingHash === hashTexto(producto.textoBusqueda),
    descuento: producto.descuento ? aDescuentoPublico(producto.descuento, producto.moneda) : null,
    imagenActualizada: producto.imagen?.updatedAt ?? null,
    solicitud: leerSolicitud(producto.solicitud),
    precioReferenciaCentavos: producto.precioReferenciaCentavos,
    materiales: producto.materiales,
    cuotasMax: producto.cuotasMax,
    receta: leerReceta(producto.receta, leerSolicitud(producto.solicitud)),
    politicaCotizacion: leerPolitica(producto.politicaCotizacion),
    variantes: producto.variantes
      .filter((variante) => variante.activo)
      .map((variante) => {
        const aplicado = mejorDescuento(candidatos, producto, variante.precioCentavos, ahora);
        return {
          id: variante.id,
          sku: variante.sku,
          nombre: variante.nombre,
          precioCentavos: variante.precioCentavos,
          stock: variante.stock,
          disponible: variante.disponible,
          stockMinimo: variante.stockMinimo,
          activo: variante.activo,
          precioFinalCentavos: aplicado?.precioFinalCentavos ?? variante.precioCentavos,
          descuento: aDescuentoDeVariante(aplicado),
          imagenActualizada: variante.imagen?.updatedAt ?? null,
        };
      }),
  };
}

export type ResumenImportacion = {
  nuevos: number;
  actualizados: number;
  variantes: number;
  errores: ErrorDeFila[];
  /** Cuántos errores hubo en total; `errores` trae como mucho los primeros 200. */
  totalErrores: number;
  confirmado: boolean;
};
