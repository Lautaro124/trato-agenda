import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LARGOS, MAX_VARIANTES, MONEDAS, PRECIO_MAX_PESOS, STOCK_MAX, type Moneda } from '../comercio/catalogo.rules.js';
import { LARGO_MAX_MATERIAL, MAX_MATERIALES } from '../comercio/solicitud.rules.js';
import {
  MAX_IMAGENES_OFRECIDAS,
  MAX_PRODUCTOS_POR_CONFIRMACION,
  MAX_URLS_POR_PEDIDO,
  TIPOS_IMPORTADO,
  type TipoImportado,
} from './modelo.js';
import { LARGO_MAX_URL } from './ssrf.rules.js';

/** Body de `POST /importacion/extraer`. */
export class ExtraerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_URLS_POR_PEDIDO)
  @IsString({ each: true })
  @MaxLength(LARGO_MAX_URL, { each: true })
  urls!: string[];
}

export class VarianteConfirmadaDto {
  @IsString()
  @MaxLength(LARGOS.variante)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGOS.sku)
  sku?: string;

  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX_PESOS * 100)
  precioCentavos!: number;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stock?: number | null;
}

/**
 * El producto ya revisado (y editado) por el dueño. De stock lleva precio en
 * cada variante; a medida, en pesos, con precio "desde", materiales y
 * versiones con precio fijo opcionales (sin stock): lo valida desdeDto con
 * las mismas reglas que el editor.
 */
export class ProductoConfirmadoDto {
  @IsIn(TIPOS_IMPORTADO)
  tipo!: TipoImportado;

  @IsString()
  @MinLength(1)
  @MaxLength(LARGOS.codigo)
  codigo!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(LARGOS.nombre)
  nombre!: string;

  @IsString()
  @MaxLength(LARGOS.descripcion)
  descripcion!: string;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(LARGOS.categoria)
  categoria?: string | null;

  @IsIn(MONEDAS)
  moneda!: Moneda;

  /** De stock, al menos una (lo exige desdeDto); a medida, las versiones con precio fijo, que pueden no estar. */
  @IsArray()
  @ArrayMaxSize(MAX_VARIANTES)
  @ValidateNested({ each: true })
  @Type(() => VarianteConfirmadaDto)
  variantes!: VarianteConfirmadaDto[];

  /** Sólo a medida: el precio "desde". */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX_PESOS * 100)
  precioReferenciaCentavos?: number | null;

  /** Sólo a medida: con qué materiales se hace. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MATERIALES)
  @IsString({ each: true })
  @MaxLength(LARGO_MAX_MATERIAL, { each: true })
  materiales?: string[];
}

export class ItemConfirmadoDto {
  @IsString()
  @MaxLength(200)
  claveOrigen!: string;

  @IsString()
  @MaxLength(LARGO_MAX_URL)
  origenUrl!: string;

  @IsArray()
  @ArrayMaxSize(MAX_IMAGENES_OFRECIDAS)
  @IsString({ each: true })
  @MaxLength(LARGO_MAX_URL, { each: true })
  imagenes!: string[];

  @IsString()
  @MaxLength(40)
  emitidaAt!: string;

  @IsString()
  @MaxLength(200)
  firma!: string;

  /** "crear" saltea si ya existe; "actualizar" lo pisa (el dueño lo eligió en la vista previa). */
  @IsIn(['crear', 'actualizar'])
  accion!: 'crear' | 'actualizar';

  /** Cuál de `imagenes` guardar como foto; null = ninguna. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_IMAGENES_OFRECIDAS - 1)
  imagenElegida?: number | null;

  @ValidateNested()
  @Type(() => ProductoConfirmadoDto)
  producto!: ProductoConfirmadoDto;
}

/** Body de `POST /importacion/confirmar`. */
export class ConfirmarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCTOS_POR_CONFIRMACION)
  @ValidateNested({ each: true })
  @Type(() => ItemConfirmadoDto)
  productos!: ItemConfirmadoDto[];
}
