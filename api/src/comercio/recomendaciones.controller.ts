import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import {
  MAX_ELEMENTOS_CON_PROPIEDADES,
  MAX_RECOMENDACIONES,
  SIN_COINCIDENCIA,
  type ConfiguracionRecomendaciones,
  type SinCoincidencia,
} from './recomendaciones.rules.js';
import { RecomendacionesService } from './recomendaciones.service.js';

export class GuardarRecomendacionesDto {
  /** La forma de cada una la valida normalizarConfiguracion (recomendaciones.rules.ts). */
  @IsArray()
  @ArrayMaxSize(MAX_RECOMENDACIONES)
  @IsObject({ each: true })
  recomendaciones!: Array<Record<string, unknown>>;

  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTOS_CON_PROPIEDADES)
  @IsObject({ each: true })
  propiedades!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(SIN_COINCIDENCIA)
  sinCoincidencia?: SinCoincidencia;
}

/** Recomendaciones y flujos de la cuenta (LAU-105). El probador está en conversation/. */
@Controller('recomendaciones')
@UseGuards(JwtAuthGuard)
export class RecomendacionesController {
  constructor(private readonly recomendaciones: RecomendacionesService) {}

  @Get()
  obtener(@CurrentUser() user: User): Promise<ConfiguracionRecomendaciones> {
    return this.recomendaciones.obtener(user.id);
  }

  @Put()
  guardar(@CurrentUser() user: User, @Body() dto: GuardarRecomendacionesDto): Promise<ConfiguracionRecomendaciones> {
    return this.recomendaciones.guardar(user.id, {
      recomendaciones: dto.recomendaciones,
      propiedades: dto.propiedades,
      sinCoincidencia: dto.sinCoincidencia ?? 'catalogo',
    });
  }
}
