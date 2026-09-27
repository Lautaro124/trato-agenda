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
import type { Producto, Variante } from '../generated/prisma/client.js';
import { hashTexto, LARGOS, MAX_FILAS_IMPORTACION, MAX_VARIANTES, PRECIO_MAX_PESOS, STOCK_MAX } from './catalogo.rules.js';

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
>;

export type ProductoPublico = Pick<
  Producto,
  'id' | 'codigo' | 'nombre' | 'descripcion' | 'categoria' | 'activo' | 'updatedAt'
> & {
  variantes: VariantePublica[];
  /** true cuando el embedding está al día: el asistente ya lo encuentra por significado. */
  indexado: boolean;
};

export function aProductoPublico(producto: Producto & { variantes: Variante[] }): ProductoPublico {
  return {
    id: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria: producto.categoria,
    activo: producto.activo,
    updatedAt: producto.updatedAt,
    indexado: producto.embeddingHash === hashTexto(producto.textoBusqueda),
    variantes: producto.variantes
      .filter((variante) => variante.activo)
      .map((variante) => ({
        id: variante.id,
        sku: variante.sku,
        nombre: variante.nombre,
        precioCentavos: variante.precioCentavos,
        stock: variante.stock,
        disponible: variante.disponible,
        stockMinimo: variante.stockMinimo,
        activo: variante.activo,
      })),
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
