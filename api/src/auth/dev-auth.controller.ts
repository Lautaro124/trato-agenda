import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AgentsService } from '../agents/agents.service.js';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { nombreCookie, opcionesDeCookie, SIETE_DIAS_MS } from './cookie.js';
import { EMAIL_DEV_POR_DEFECTO } from './usuario-dev.js';

export class DevLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /** Cada email es un usuario dev distinto: sirve para probar altas desde cero. */
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;
}

/**
 * El login con contraseña sólo existe fuera de producción y con
 * DEV_LOGIN_PASSWORD definida. Es el segundo candado: el primero es que
 * AuthModule ni siquiera registra este controller en producción, y el
 * tercero que validateEnv no arranca si la contraseña llega a un deploy.
 */
export function loginDevHabilitado(config: ConfigService<Env, true>): boolean {
  return (
    config.get('NODE_ENV', { infer: true }) !== 'production' &&
    Boolean(config.get('DEV_LOGIN_PASSWORD', { infer: true }))
  );
}

/** Comparación en tiempo constante; los hashes igualan el largo que exige timingSafeEqual. */
export function contrasenaCorrecta(recibida: string, esperada: string): boolean {
  const a = createHash('sha256').update(recibida).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

@Controller('auth/dev')
export class DevAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly agentsService: AgentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Le dice a /entrar si tiene que mostrar el formulario de contraseña. */
  @Get()
  estado(): { habilitado: boolean } {
    return { habilitado: loginDevHabilitado(this.config) };
  }

  /**
   * Misma cookie que el callback de Google, pero contesta JSON en vez de
   * redirigir: lo llama un `fetch` del front, que después navega a `destino`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: DevLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ destino: '/inicio' | '/contanos' }> {
    if (!loginDevHabilitado(this.config)) {
      throw new NotFoundException();
    }
    if (!contrasenaCorrecta(dto.password, this.config.get('DEV_LOGIN_PASSWORD', { infer: true }))) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }

    const user = await this.authService.upsertUsuarioDev(dto.email?.trim().toLowerCase() || EMAIL_DEV_POR_DEFECTO);
    const token = await this.authService.issueSessionToken(user);
    res.cookie(nombreCookie(this.config), token, { ...opcionesDeCookie(this.config), maxAge: SIETE_DIAS_MS });

    const tieneAgente = (await this.agentsService.findByUserId(user.id)) !== null;
    return { destino: tieneAgente ? '/inicio' : '/contanos' };
  }
}
