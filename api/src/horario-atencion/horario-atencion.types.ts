import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsString, MaxLength, ValidateNested } from 'class-validator';
import { FranjaLocalDto } from '../agents/agents.types.js';
import { MAX_FRANJAS } from '../agents/local.js';
import type { HorarioAtencion } from './horario-atencion.rules.js';

/**
 * Body de `PUT /horario-atencion`. Que la zona sea de la lista, que cada día
 * cierre después de abrir y que activo traiga franjas lo mira
 * normalizarHorarioAtencion (horario-atencion.rules.ts).
 */
export class ActualizarHorarioAtencionDto {
  @IsBoolean()
  activo!: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_FRANJAS)
  @ValidateNested({ each: true })
  @Type(() => FranjaLocalDto)
  franjas!: FranjaLocalDto[];

  @IsString()
  @MaxLength(64)
  zona!: string;
}

export type HorarioAtencionPublico = HorarioAtencion & { resumen: string };
