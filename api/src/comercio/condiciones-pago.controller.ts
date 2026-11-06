import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import {
  LARGO_MAX_MENSAJE_COBRO,
  LARGO_MAX_TITULAR,
  MODOS_COBRO_MANUAL,
  type CondicionesPago,
} from './condiciones-pago.rules.js';
import { CondicionesInvalidasError, CondicionesPagoService } from './condiciones-pago.service.js';
import { PORCENTAJE_MAX } from './descuentos.rules.js';

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
  /** null = sin descuento; sin el campo, queda el que estaba. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PORCENTAJE_MAX)
  descuentoEfectivoPorcentaje?: number | null;

  /** null = coordinar por el chat; sin el campo, queda el que estaba. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CobroManualDto)
  cobroManual?: CobroManualDto | null;
}

/** Descuento en efectivo y cobro sin link del comercio (LAU-34); las cuotas van por producto. */
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
