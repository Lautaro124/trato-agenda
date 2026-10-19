import {
  BadRequestException,
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { MAX_CARACTERES, TIPOS_SUGERENCIA, type TipoSugerencia } from './mejoras.rules.js';
import { MejorasService } from './mejoras.service.js';

export class CrearSugerenciaDto {
  @IsIn(TIPOS_SUGERENCIA)
  tipo!: TipoSugerencia;

  /** Corte grueso; el fino (lista blanca, links, largo real) es validarSugerencia. */
  @IsString()
  @MaxLength(MAX_CARACTERES * 2)
  texto!: string;
}

const CAMPOS = new Set(['tipo', 'texto']);

/**
 * Corre antes que los pipes, sobre el cuerpo crudo: el ValidationPipe global
 * tiene `whitelist` sin `forbidNonWhitelisted`, así que un campo de más se
 * descartaría en silencio. Acá se rechaza, y cualquier Content-Type que no
 * sea JSON (multipart, form-data: archivos) no llega a procesarse.
 */
@Injectable()
export class SoloTextoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.is('application/json')) throw new UnsupportedMediaTypeException('Sólo se acepta texto.');
    const cuerpo: unknown = req.body;
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      throw new BadRequestException('Falta la sugerencia.');
    }
    if (Object.keys(cuerpo).some((campo) => !CAMPOS.has(campo))) {
      throw new BadRequestException('Sólo se aceptan el tipo y el texto.');
    }
    return true;
  }
}

/** Sugerencias de mejora (LAU-14). */
@Controller('mejoras')
@UseGuards(JwtAuthGuard, SoloTextoGuard)
export class MejorasController {
  constructor(private readonly mejoras: MejorasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(@CurrentUser() user: User, @Body() dto: CrearSugerenciaDto): Promise<{ ok: true }> {
    await this.mejoras.crear(user.id, dto.tipo, dto.texto);
    // Nunca devuelve el texto ni si llegó a Linear: el usuario no ve el estado.
    return { ok: true };
  }
}
