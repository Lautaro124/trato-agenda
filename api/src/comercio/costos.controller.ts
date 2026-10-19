import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import {
  COSTO_MAX_CENTAVOS,
  DESGLOSES,
  LARGO_MAX_NOMBRE_EXTRA,
  LARGO_MAX_NOMBRE_INSUMO,
  MAX_EXTRAS,
  REDONDEO_MAX_CENTAVOS,
  TIPOS_INSUMO,
  UNIDADES_INSUMO,
  VIGENCIA_MAX_DIAS,
  type ConfigCotizacion,
  type Insumo,
} from './costos.rules.js';
import { CostosInvalidosError, CostosService, type CostosDelComercio } from './costos.service.js';
import type { Cotizacion, CotizacionFallida } from './cotizacion.rules.js';
import { SolicitudDto } from './productos.types.js';
import { LARGO_MAX_RESPUESTA, MAX_PREGUNTAS } from './solicitud.rules.js';

export class InsumoDto {
  @IsIn(TIPOS_INSUMO)
  tipo!: (typeof TIPOS_INSUMO)[number];

  @IsString()
  @MaxLength(LARGO_MAX_NOMBRE_INSUMO)
  nombre!: string;

  @IsIn(UNIDADES_INSUMO)
  unidad!: (typeof UNIDADES_INSUMO)[number];

  @IsInt()
  @Min(1)
  @Max(COSTO_MAX_CENTAVOS)
  costoCentavos!: number;
}

export class ExtraGeneralDto {
  @IsString()
  @MaxLength(LARGO_MAX_NOMBRE_EXTRA)
  nombre!: string;

  @IsIn(['fijo', 'porcentaje'])
  modo!: 'fijo' | 'porcentaje';

  @IsNumber({ allowNaN: false, allowInfinity: false })
  valor!: number;
}

export class ConfigCotizacionDto {
  @IsArray()
  @ArrayMaxSize(MAX_EXTRAS)
  @ValidateNested({ each: true })
  @Type(() => ExtraGeneralDto)
  extras!: ExtraGeneralDto[];

  @IsInt()
  @Min(0)
  @Max(REDONDEO_MAX_CENTAVOS)
  redondeoCentavos!: number;

  @IsBoolean()
  estimativo!: boolean;

  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(1)
  @Max(VIGENCIA_MAX_DIAS)
  vigenciaDias!: number | null;

  @IsIn(DESGLOSES)
  desgloseAlCliente!: (typeof DESGLOSES)[number];
}

export class RespuestaDto {
  @IsString()
  @MaxLength(200)
  pregunta!: string;

  @IsString()
  @MaxLength(LARGO_MAX_RESPUESTA)
  respuesta!: string;
}

/** La vista previa del editor de recetas: lo que se está editando, sin guardar. */
export class SimularDto {
  @IsObject()
  receta!: Record<string, unknown>;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @ValidateNested()
  @Type(() => SolicitudDto)
  solicitud?: SolicitudDto | null;

  @IsArray()
  @ArrayMaxSize(MAX_PREGUNTAS)
  @ValidateNested({ each: true })
  @Type(() => RespuestaDto)
  respuestas!: RespuestaDto[];
}

/** Lo que sale mal por los datos es un 400 con el motivo. */
async function conCostos<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion();
  } catch (error) {
    if (error instanceof CostosInvalidosError) throw new BadRequestException(error.message);
    throw error;
  }
}

/** Materiales y costos de los productos a medida (LAU-26): /costos en la web. */
@Controller('costos')
@UseGuards(JwtAuthGuard)
export class CostosController {
  constructor(private readonly costos: CostosService) {}

  @Get()
  obtener(@CurrentUser() user: User): Promise<CostosDelComercio> {
    return this.costos.obtener(user.id);
  }

  @Post('insumos')
  crearInsumo(@CurrentUser() user: User, @Body() dto: InsumoDto): Promise<Insumo> {
    return conCostos(() => this.costos.crearInsumo(user.id, dto));
  }

  @Patch('insumos/:id')
  actualizarInsumo(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: InsumoDto): Promise<Insumo> {
    return conCostos(() => this.costos.actualizarInsumo(user.id, id, dto));
  }

  @Delete('insumos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  borrarInsumo(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.costos.borrarInsumo(user.id, id);
  }

  @Put('config')
  guardarConfig(@CurrentUser() user: User, @Body() dto: ConfigCotizacionDto): Promise<ConfigCotizacion> {
    return conCostos(() => this.costos.guardarConfig(user.id, dto));
  }

  @Post('simular')
  @HttpCode(HttpStatus.OK)
  simular(@CurrentUser() user: User, @Body() dto: SimularDto): Promise<Cotizacion | CotizacionFallida> {
    return this.costos.simular(user.id, dto);
  }
}
