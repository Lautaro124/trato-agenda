import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
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
import { HistoricoVentasService, type ListadoVentas, type ResumenVentas } from './historico.service.js';
import { RangoInvalidoError } from './historico.rules.js';
import { VentasService } from './ventas.service.js';
import { aVentaPublica, FiltrosVentasQuery, type VentaPublica } from './ventas.types.js';

/** Un rango de fechas mal armado es un 400 con el motivo, no un 500. */
async function conRango<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion();
  } catch (error) {
    if (error instanceof RangoInvalidoError) throw new BadRequestException(error.message);
    throw error;
  }
}

/** Pagos del asistente de ventas y las acciones del dueño sobre sus pedidos. */
@Controller('ventas')
export class VentasController {
  private readonly logger = new Logger(VentasController.name);

  constructor(
    private readonly ventas: VentasService,
    private readonly historico: HistoricoVentasService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** El histórico del dueño, con filtros y los totales del período. */
  @Get()
  @UseGuards(JwtAuthGuard)
  listar(@CurrentUser() user: User, @Query() filtros: FiltrosVentasQuery): Promise<ListadoVentas> {
    return conRango(() => this.historico.listar(user.id, filtros));
  }

  /** Cobrado por día y productos más vendidos, para los gráficos. */
  @Get('resumen')
  @UseGuards(JwtAuthGuard)
  resumen(@CurrentUser() user: User, @Query() filtros: FiltrosVentasQuery): Promise<ResumenVentas> {
    return conRango(() => this.historico.resumen(user.id, filtros));
  }

  @Get('export.csv')
  @UseGuards(JwtAuthGuard)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ventas.csv"')
  @Header('Cache-Control', 'no-store')
  exportar(@CurrentUser() user: User, @Query() filtros: FiltrosVentasQuery): Promise<string> {
    return conRango(() => this.historico.exportarCsv(user.id, filtros));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async obtener(@CurrentUser() user: User, @Param('id') id: string): Promise<VentaPublica> {
    const venta = await this.historico.obtener(user.id, id);
    if (!venta) throw new NotFoundException('No existe esa venta.');
    return venta;
  }

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
