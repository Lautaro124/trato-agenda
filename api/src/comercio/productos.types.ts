import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import type { Descuento, Producto, Variante } from '../generated/prisma/client.js';
import { hashTexto, LARGOS, MAX_FILAS_IMPORTACION, MAX_VARIANTES, PRECIO_MAX_PESOS, STOCK_MAX } from './catalogo.rules.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANTES)
  @ValidateNested({ each: true })
  @Type(() => VarianteDto)
  variantes!: VarianteDto[];

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
};

export type ProductoPublico = Pick<
  Producto,
  'id' | 'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'activo' | 'updatedAt'
> & {
  variantes: VariantePublica[];
  /** El descuento propio del producto (el del formulario), vigente o no. */
  descuento: DescuentoPublico | null;
  /** true cuando el embedding está al día: el asistente ya lo encuentra por significado. */
  indexado: boolean;
};

/**
 * `promociones` son las promos de catálogo y de categoría de la cuenta (las
 * de `descuentosActivos`): con ellas y el descuento propio se calcula el
 * precio final de cada variante.
 */
export function aProductoPublico(
  producto: Producto & { variantes: Variante[]; descuento?: Descuento | null },
  promociones: DescuentoParaAplicar[] = [],
  ahora: Date = new Date(),
): ProductoPublico {
  const candidatos = [
    ...(producto.descuento ? [producto.descuento] : []),
    ...promociones.filter((promocion) => promocion.productoId === null),
  ];
  return {
    id: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria: producto.categoria,
    activo: producto.activo,
    updatedAt: producto.updatedAt,
    indexado: producto.embeddingHash === hashTexto(producto.textoBusqueda),
    descuento: producto.descuento ? aDescuentoPublico(producto.descuento) : null,
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
        };
      }),
  };
}

export type ResumenImportacion = {
  nuevos: number;
  actualizados: number;
  variantes: number;
  errores: Array<{ fila: number; mensaje: string }>;
  /** Cuántos errores hubo en total; `errores` trae como mucho los primeros 200. */
  totalErrores: number;
  confirmado: boolean;
};
