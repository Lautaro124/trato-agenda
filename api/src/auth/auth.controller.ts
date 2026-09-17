import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import { CALENDARIO_GOOGLE, CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { CuentaService } from './cuenta.service.js';
import { aUsuarioPublico, type UsuarioPublico } from './auth.types.js';
import { nombreCookie, opcionesDeCookie } from './cookie.js';
import { COOKIE_CONECTAR, SEGUNDOS_CONECTAR } from './cookies-de-paso.js';
import { CurrentUser } from './current-user.decorator.js';
import { GoogleAuthGuard, type RequestConConexion } from './guards/google-auth.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { LoginWhatsappService } from './login-whatsapp.service.js';
import { PASSWORD_MAX } from './password.js';
import { destinoTrasLogin, ponerCookieDeSesion } from './sesion.js';
import { ReglasDePassword } from './password.dto.js';
import type { User } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

export class CambiarPasswordDto {
  @ReglasDePassword()
  nueva!: string;

  /** Obligatoria sólo si la cuenta ya tiene contraseña. */
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  actual?: string;
}

/** Lo que /cuenta lee de `?google=` al volver de conectar Google. */
type ResultadoEnCuenta = 'conectado' | 'google_en_uso' | 'migracion_incompleta';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly cuentaService: CuentaService,
    private readonly agentsService: AgentsService,
    private readonly calendarService: CalendarService,
    private readonly logins: LoginWhatsappService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Arranca el flujo: el guard redirige a la pantalla de consentimiento. */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google(): void {}

  /**
   * Una cuenta ya logueada (típicamente creada con WhatsApp) suma su Google
   * Calendar: deja una cookie corta que el callback reconoce y va al mismo
   * consentimiento que el login.
   */
  @Get('google/conectar')
  @UseGuards(JwtAuthGuard)
  async conectarGoogle(@CurrentUser() user: User, @Res() res: Response): Promise<void> {
    const token = await this.authService.emitirTokenDePaso(user.id, 'conectar', SEGUNDOS_CONECTAR);
    res.cookie(COOKIE_CONECTAR, token, { ...opcionesDeCookie(this.config), maxAge: SEGUNDOS_CONECTAR * 1000 });
    res.redirect('/auth/google');
  }

  /** Vuelta de Google: firmamos la sesión, la dejamos en cookie y volvemos al front. */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: User,
    @Req() req: RequestConConexion,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    ponerCookieDeSesion(res, this.config, await this.authService.issueSessionToken(user));
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });

    if (req.conexionGoogle) {
      res.clearCookie(COOKIE_CONECTAR, opcionesDeCookie(this.config));
      const resultado = req.conexionGoogle === 'conectado' ? await this.pasarAGoogle(user) : req.conexionGoogle;
      res.redirect(`${frontendUrl}/cuenta?google=${resultado}`);
      return;
    }

    res.redirect(`${frontendUrl}${await destinoTrasLogin(this.agentsService, user)}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): UsuarioPublico {
    return aUsuarioPublico(user);
  }

  /** Poner (después del QR) o cambiar la contraseña de una cuenta con WhatsApp. */
  @Post('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cambiarPassword(@CurrentUser() user: User, @Body() dto: CambiarPasswordDto): Promise<void> {
    return this.logins.cambiarPassword(user, dto.nueva, dto.actual);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(nombreCookie(this.config), opcionesDeCookie(this.config));
    res.clearCookie(COOKIE_CONECTAR, opcionesDeCookie(this.config));
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

  /**
   * Copia la agenda local a Google y recién si no quedó nada pendiente cambia
   * `calendario`: con un corte a mitad, la cuenta sigue en local (con lo que
   * falta) y reintenta la próxima vez que conecte.
   */
  private async pasarAGoogle(user: User): Promise<ResultadoEnCuenta> {
    if (user.calendario === CALENDARIO_GOOGLE) return 'conectado';
    const { migrados, pendientes } = await this.calendarService.migrarLocalAGoogle(user);
    this.logger.log(`Google conectado para ${user.id}: ${migrados} eventos copiados, ${pendientes} pendientes.`);
    if (pendientes > 0) return 'migracion_incompleta';
    await this.prisma.user.update({ where: { id: user.id }, data: { calendario: CALENDARIO_GOOGLE } });
    return 'conectado';
  }
}
