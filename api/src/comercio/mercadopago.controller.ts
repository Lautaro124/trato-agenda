import { Controller, Delete, Get, HttpCode, HttpStatus, Logger, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { CuentaMercadoPagoService, type EstadoCuentaMp } from './cuenta-mercadopago.service.js';

/** Lo que /cuenta lee de `?mp=` al volver de Mercado Pago. */
type ResultadoConexion = 'conectado' | 'cancelado' | 'error';

/**
 * Conexión de la cuenta de Mercado Pago del comercio (OAuth). Todo va con la
 * sesión: el callback vuelve a este mismo navegador, y el `state` tiene que
 * ser uno emitido para el usuario logueado.
 */
@Controller('mercadopago')
@UseGuards(JwtAuthGuard)
export class MercadoPagoController {
  private readonly logger = new Logger(MercadoPagoController.name);

  constructor(
    private readonly cuentas: CuentaMercadoPagoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('estado')
  async estado(@CurrentUser() user: User): Promise<EstadoCuentaMp & { disponible: boolean }> {
    return { disponible: this.cuentas.configurado, ...(await this.cuentas.estado(user.id)) };
  }

  /** Navegación completa desde la web: redirige a la pantalla de autorización de Mercado Pago. */
  @Get('conectar')
  conectar(@CurrentUser() user: User, @Res() res: Response): void {
    if (!this.cuentas.configurado) {
      res.redirect(this.volver('error'));
      return;
    }
    res.redirect(this.cuentas.iniciarConexion(user.id));
  }

  @Get('callback')
  async callback(
    @CurrentUser() user: User,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      // El dueño apretó "Cancelar" en Mercado Pago (vuelve con ?error=…).
      res.redirect(this.volver('cancelado'));
      return;
    }
    try {
      await this.cuentas.completarConexion(user.id, state, code);
      res.redirect(this.volver('conectado'));
    } catch (error) {
      this.logger.warn(`No se pudo conectar Mercado Pago para ${user.id}: ${(error as Error).message}`);
      res.redirect(this.volver('error'));
    }
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async desconectar(@CurrentUser() user: User): Promise<void> {
    await this.cuentas.desconectar(user.id);
  }

  private volver(resultado: ResultadoConexion): string {
    return `${this.config.get('FRONTEND_URL', { infer: true })}/cuenta?mp=${resultado}`;
  }
}
