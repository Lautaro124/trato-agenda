import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { MercadoPagoError } from './mercadopago.client.js';
import { SubscriptionService } from './subscription.service.js';
import { MercadoPagoWebhookDto, type SuscripcionPublica } from './subscription.types.js';
import { firmaDeWebhookValida } from './webhook-signature.js';

/** Tipos de notificación de Mercado Pago que nos mueven el estado. */
const TIPOS_DE_INTERES = ['subscription_preapproval', 'preapproval'];

@Controller('suscripcion')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async estado(@CurrentUser() user: User): Promise<SuscripcionPublica> {
    return this.subscriptionService.estadoPublico(user.id);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async checkout(@CurrentUser() user: User): Promise<{ initPoint: string }> {
    try {
      return await this.subscriptionService.crearCheckout(user);
    } catch (error) {
      if (error instanceof MercadoPagoError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  @Post('cancelar')
  @UseGuards(JwtAuthGuard)
  async cancelar(@CurrentUser() user: User): Promise<SuscripcionPublica> {
    try {
      return await this.subscriptionService.cancelar(user.id);
    } catch (error) {
      if (error instanceof MercadoPagoError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  /**
   * Notificaciones de Mercado Pago. Es la única ruta sin guard del módulo, así
   * que se verifica la firma antes de tocar nada, y ni siquiera entonces se
   * confía en el cuerpo: el estado se vuelve a pedir por API.
   *
   * Siempre responde 200 — un 5xx haría que Mercado Pago reintente en loop.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() dto: MercadoPagoWebhookDto,
    @Query() query: Record<string, string>,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ): Promise<{ recibido: boolean }> {
    const dataId = dto.data?.id ?? query['data.id'] ?? query.id;
    const tipo = dto.type ?? query.type ?? query.topic;

    const firmaOk = firmaDeWebhookValida({
      secret: this.config.get('MERCADOPAGO_WEBHOOK_SECRET', { infer: true }),
      xSignature,
      xRequestId,
      dataId,
    });
    if (!firmaOk) {
      this.logger.warn('Webhook de Mercado Pago con firma inválida: se ignora.');
      return { recibido: false };
    }

    if (!dataId || !tipo || !TIPOS_DE_INTERES.includes(tipo)) {
      return { recibido: true };
    }

    try {
      await this.subscriptionService.sincronizarDesdeMp(dataId);
    } catch (error) {
      // Nunca propagamos: Mercado Pago reintenta y ya tenemos el id logueado.
      this.logger.error(`Fallo sincronizando el preapproval ${dataId}`, error as Error);
    }

    return { recibido: true };
  }
}
