import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { AgentsService } from '../agents/agents.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { AltaWhatsappService } from './alta-whatsapp.service.js';
import { AuthService } from './auth.service.js';
import type { DestinoTrasLogin } from './auth.types.js';
import { CodigoAccesoService } from './codigo-acceso.service.js';
import { opcionesDeCookie } from './cookie.js';
import { COOKIE_ALTA, SEGUNDOS_ALTA } from './cookies-de-paso.js';
import { AltaGuard, type RequestConAlta } from './guards/alta.guard.js';
import { normalizarTelefono } from './telefono.js';
import { LoginWhatsappService } from './login-whatsapp.service.js';
import { ReglasDePassword } from './password.dto.js';
import { PASSWORD_MAX } from './password.js';
import { destinoTrasLogin, ponerCookieDeSesion } from './sesion.js';

const aTelefono = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizarTelefono(value) : value);

export class SolicitarCodigoDto {
  @Transform(aTelefono)
  @IsString()
  @Matches(/^\d{8,15}$/, { message: 'El número tiene que tener entre 8 y 15 dígitos, con código de país.' })
  telefono!: string;
}

export class LoginWhatsappDto extends SolicitarCodigoDto {
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

/** Recuperar: el código prueba que se tiene el WhatsApp y se elige una contraseña nueva. */
export class VerificarCodigoDto extends SolicitarCodigoDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos.' })
  codigo!: string;

  @ReglasDePassword()
  nuevaPassword!: string;
}

/**
 * Las puertas de entrada sin Google: crear la cuenta escaneando el QR, entrar
 * con número + contraseña, y recuperar la contraseña con un código que llega
 * al chat propio de WhatsApp. Son públicas; los límites de abuso viven en los
 * servicios.
 */
@Controller('auth/whatsapp')
export class WhatsappAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly altas: AltaWhatsappService,
    private readonly codigos: CodigoAccesoService,
    private readonly logins: LoginWhatsappService,
    private readonly whatsappService: WhatsappService,
    private readonly agentsService: AgentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Crea el usuario pendiente, deja la cookie del alta y arranca el QR. */
  @Post('alta')
  @HttpCode(HttpStatus.ACCEPTED)
  async iniciarAlta(@Ip() ip: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    const user = await this.altas.iniciar(ip);
    const token = await this.authService.emitirTokenDePaso(user.id, 'alta', SEGUNDOS_ALTA);
    res.cookie(COOKIE_ALTA, token, { ...opcionesDeCookie(this.config), maxAge: SEGUNDOS_ALTA * 1000 });
  }

  /** Mismo stream que /whatsapp/link/stream, pero para el usuario del alta. */
  @Sse('alta/stream')
  @UseGuards(AltaGuard)
  streamAlta(@Req() req: RequestConAlta): Observable<MessageEvent> {
    return this.whatsappService.linkEvents$(req.altaUserId);
  }

  /** Pide un QR nuevo (el anterior venció) sin crear otro usuario. */
  @Post('alta/reintentar')
  @UseGuards(AltaGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  reintentarAlta(@Req() req: RequestConAlta): Promise<void> {
    return this.whatsappService.startLink(req.altaUserId);
  }

  /** Después del "connected": cambia la cookie del alta por la de sesión. */
  @Post('alta/finalizar')
  @UseGuards(AltaGuard)
  @HttpCode(HttpStatus.OK)
  async finalizarAlta(
    @Req() req: RequestConAlta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ destino: DestinoTrasLogin }> {
    const user = await this.altas.finalizar(req.altaUserId);
    res.clearCookie(COOKIE_ALTA, opcionesDeCookie(this.config));
    return this.entrar(user, res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginWhatsappDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ destino: DestinoTrasLogin }> {
    const user = await this.logins.entrar(dto.telefono, dto.password, ip);
    return this.entrar(user, res);
  }

  /** Siempre 202: la respuesta no dice si el número tiene cuenta. */
  @Post('codigo')
  @HttpCode(HttpStatus.ACCEPTED)
  solicitarCodigo(@Body() dto: SolicitarCodigoDto, @Ip() ip: string): void {
    this.codigos.solicitar(dto.telefono, ip);
  }

  @Post('codigo/verificar')
  @HttpCode(HttpStatus.OK)
  async verificarCodigo(
    @Body() dto: VerificarCodigoDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ destino: DestinoTrasLogin }> {
    const { id } = await this.codigos.verificar(dto.telefono, dto.codigo);
    return this.entrar(await this.logins.guardar(id, dto.nuevaPassword), res);
  }

  private async entrar(user: User, res: Response): Promise<{ destino: DestinoTrasLogin }> {
    ponerCookieDeSesion(res, this.config, await this.authService.issueSessionToken(user));
    return { destino: await destinoTrasLogin(this.agentsService, user) };
  }
}
