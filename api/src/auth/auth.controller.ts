import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import { AuthService } from './auth.service.js';
import { CuentaService } from './cuenta.service.js';
import { aUsuarioPublico, type UsuarioPublico } from './auth.types.js';
import { nombreCookie, opcionesDeCookie, SIETE_DIAS_MS } from './cookie.js';
import { CurrentUser } from './current-user.decorator.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cuentaService: CuentaService,
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
    res.cookie(nombreCookie(this.config), token, { ...opcionesDeCookie(this.config), maxAge: SIETE_DIAS_MS });

    // Si ya tiene un agente generado, no repite el onboarding: va directo a su Home.
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    res.redirect(`${frontendUrl}${await this.destinoTrasLogin(user)}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): UsuarioPublico {
    return aUsuarioPublico(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(nombreCookie(this.config), opcionesDeCookie(this.config));
  }

  /**
   * Baja de cuenta: revoca el acceso a Google y borra todos los datos. No tiene
   * vuelta atrás, así que el front pide confirmación escrita antes de llamar.
   * `chequeoDeOrigen` ya corta cualquier DELETE que no venga del front.
   */
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminarCuenta(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.cuentaService.eliminar(user);
    res.clearCookie(nombreCookie(this.config), opcionesDeCookie(this.config));
  }

  private async destinoTrasLogin(user: User): Promise<'/inicio' | '/contanos'> {
    const yaTieneAgente = (await this.agentsService.findByUserId(user.id)) !== null;
    return yaTieneAgente ? '/inicio' : '/contanos';
  }
}
