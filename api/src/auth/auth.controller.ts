import { Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import { AuthService } from './auth.service.js';
import { aUsuarioPublico, type UsuarioPublico } from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly agentsService: AgentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Arranca el flujo: el guard redirige a la pantalla de consentimiento. */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google(): void {}

  /** Vuelta de Google: firmamos la sesión, la dejamos en cookie y volvemos al front. */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = await this.authService.issueSessionToken(user);
    res.cookie(this.cookieName, token, { ...this.cookieOptions, maxAge: SIETE_DIAS_MS });

    // Si ya tiene un agente generado, no repite el onboarding: va directo a su Home.
    const yaTieneAgente = (await this.agentsService.findByUserId(user.id)) !== null;
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    res.redirect(`${frontendUrl}${yaTieneAgente ? '/inicio' : '/contanos'}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): UsuarioPublico {
    return aUsuarioPublico(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(this.cookieName, this.cookieOptions);
  }

  private get cookieName(): string {
    return this.config.get('SESSION_COOKIE_NAME', { infer: true });
  }

  private get cookieOptions(): CookieOptions {
    const enProduccion = this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      httpOnly: true,
      // En producción el front y la API viven en dominios distintos
      // (*.up.railway.app está en la Public Suffix List, así que ni siquiera son
      // el mismo sitio): con 'lax' el browser no manda la cookie en las llamadas
      // del front y /auth/me contesta 401 siempre. 'none' exige secure, que ahí ya está.
      // Contra conocida: Safari/iOS bloquea las cookies de terceros aunque sean
      // SameSite=None, así que el login falla en ese browser hasta que front y API
      // compartan dominio (subdominios propios, o un rewrite /api/* en Next).
      sameSite: enProduccion ? 'none' : 'lax',
      secure: enProduccion,
      path: '/',
    };
  }
}
