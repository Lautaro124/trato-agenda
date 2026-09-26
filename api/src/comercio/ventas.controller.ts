import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { MercadoPagoWebhookDto } from '../subscription/subscription.types.js';
import { firmaDeWebhookValida } from '../subscription/webhook-signature.js';
import { VentasService } from './ventas.service.js';
import { aVentaPublica, type VentaPublica } from './ventas.types.js';

/** Pagos del asistente de ventas y las acciones del dueño sobre sus pedidos. */
@Controller('ventas')
export class VentasController {
  private readonly logger = new Logger(VentasController.name);

  constructor(
    private readonly ventas: VentasService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Notificaciones de Mercado Pago de los links de pago de cada comercio (el
   * `notification_url` de la preferencia lleva `?venta=`). Sin guard, como
   * `/suscripcion/webhook`: se verifica la firma, se ignora el cuerpo y el
   * pago se vuelve a pedir con el token del comercio. La conciliación
   * periódica cubre lo que no llegue o no se pueda verificar.
   *
   * Siempre responde 200: un 5xx haría que Mercado Pago reintente en loop.
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
      this.logger.warn('Webhook de ventas con firma inválida: se ignora (la conciliación lo levanta igual).');
      return { recibido: false };
    }
    if (!dataId || tipo !== 'payment') return { recibido: true };

    try {
      await this.ventas.procesarPago(dataId, query.venta);
    } catch (error) {
      this.logger.error(`Fallo procesando el pago ${dataId}: ${(error as Error).message}`);
    }
    return { recibido: true };
  }

  /** El dueño cobró por fuera (transferencia, efectivo): el pedido pasa a pagado y descuenta stock. */
  @Post(':id/pagada')
  @UseGuards(JwtAuthGuard)
  async marcarPagada(@CurrentUser() user: User, @Param('id') id: string): Promise<VentaPublica> {
    const venta = await this.ventas.marcarPagadaPorElDueno(user.id, id);
    if (!venta) throw new NotFoundException('No hay un pedido pendiente con ese id.');
    return aVentaPublica(venta);
  }

  @Post(':id/cancelar')
  @UseGuards(JwtAuthGuard)
  async cancelar(@CurrentUser() user: User, @Param('id') id: string): Promise<VentaPublica> {
    const venta = await this.ventas.cancelar(user.id, id);
    if (!venta) throw new NotFoundException('No hay un pedido pendiente con ese id.');
    return aVentaPublica(venta);
  }
}
