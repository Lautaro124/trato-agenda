import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
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
  LARGO_MAX_MENSAJE_COBRO,
  LARGO_MAX_TITULAR,
  MAX_CUOTAS,
  MODOS_COBRO_MANUAL,
  MAX_PLANES_CUOTAS,
  MIN_CUOTAS,
  RECARGO_MAX_PORCENTAJE,
  type CondicionesPago,
} from './condiciones-pago.rules.js';
import { CondicionesInvalidasError, CondicionesPagoService } from './condiciones-pago.service.js';
import { PORCENTAJE_MAX } from './descuentos.rules.js';

export class PlanCuotasDto {
  @IsInt()
  @Min(MIN_CUOTAS)
  @Max(MAX_CUOTAS)
  cuotas!: number;

  @IsInt()
  @Min(0)
  @Max(RECARGO_MAX_PORCENTAJE)
  recargoPorcentaje!: number;
}

/** La forma la termina de validar normalizarCobroManual; acá sólo los topes. */
export class CobroManualDto {
  @IsIn(MODOS_COBRO_MANUAL)
  modo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_TITULAR * 2)
  titular?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_MENSAJE_COBRO * 2)
  mensaje?: string;
}

export class CondicionesPagoDto {
  @IsArray()
  @ArrayMaxSize(MAX_PLANES_CUOTAS)
  @ValidateNested({ each: true })
  @Type(() => PlanCuotasDto)
  planesCuotas!: PlanCuotasDto[];

  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(1)
  @Max(PORCENTAJE_MAX)
  descuentoEfectivoPorcentaje!: number | null;

  /** null = coordinar por el chat; sin el campo, queda el que estaba. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CobroManualDto)
  cobroManual?: CobroManualDto | null;
}

/** Cuotas, descuento en efectivo y cobro sin link del comercio (LAU-34). */
@Controller('condiciones-pago')
@UseGuards(JwtAuthGuard)
export class CondicionesPagoController {
  constructor(private readonly condiciones: CondicionesPagoService) {}

  @Get()
  obtener(@CurrentUser() user: User): Promise<CondicionesPago> {
    return this.condiciones.obtener(user.id);
  }

  @Put()
  async guardar(@CurrentUser() user: User, @Body() dto: CondicionesPagoDto): Promise<CondicionesPago> {
    try {
      return await this.condiciones.guardar(user.id, dto);
    } catch (error) {
      if (error instanceof CondicionesInvalidasError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
