import {
  BadRequestException,
  Body,
  ConflictException,
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
import { PedidosAMedidaService } from './pedidos-a-medida.service.js';
import { normalizarRenglones } from './presupuesto.rules.js';
import { PedidoRechazadoError, VentasService } from './ventas.service.js';
import {
  aDetalleVentaPublica,
  AtencionDto,
  aVentaPublica,
  CobrarDto,
  FiltrosVentasQuery,
  PresupuestoDto,
  type DetalleVentaPublica,
  type VentaPublica,
} from './ventas.types.js';

/** Un motivo de negocio (pedido cerrado, sin presupuesto…) es un 409 con el texto, no un 500. */
async function conPedido<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion();
  } catch (error) {
    if (error instanceof PedidoRechazadoError) throw new ConflictException(error.message);
    throw error;
  }
}

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
    private readonly pedidos: PedidosAMedidaService,
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

  /** Los pedidos que atiende una persona (el asistente está callado en esos chats), de todos los períodos. */
  @Get('atencion')
  @UseGuards(JwtAuthGuard)
  async esperandoAtencion(@CurrentUser() user: User): Promise<VentaPublica[]> {
    const ventas = await this.pedidos.esperandoAtencion(user.id);
    return ventas.map((venta) => aVentaPublica(venta));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  obtener(@CurrentUser() user: User, @Param('id') id: string): Promise<DetalleVentaPublica> {
    return this.detalle(user.id, id);
  }

  /** "Atender yo" (el asistente se calla en ese chat) o "Devolver al asistente". */
  @Post(':id/atencion')
  @UseGuards(JwtAuthGuard)
  async atencion(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AtencionDto): Promise<DetalleVentaPublica> {
    await conPedido(async () => {
      if (dto.humana) {
        const venta = await this.historico.obtener(user.id, id);
        if (!venta) throw new NotFoundException('No existe ese pedido.');
        await this.pedidos.derivar({
          userId: user.id,
          ventaId: id,
          conversationId: null,
          remoteJid: null,
          nombreCliente: venta.nombreCliente,
          motivo: 'dueno',
          detalle: dto.nota ?? null,
          autor: 'dueno',
          dePrueba: venta.dePrueba,
        });
      } else if (!(await this.pedidos.devolver(user.id, id, dto.nota ?? null))) {
        throw new NotFoundException('No existe ese pedido.');
      }
    });
    return this.detalle(user.id, id);
  }

  /** Un presupuesto armado a mano: queda como borrador, o se manda en el mismo paso con `enviar`. */
  @Post(':id/presupuestos')
  @UseGuards(JwtAuthGuard)
  async crearPresupuesto(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: PresupuestoDto,
  ): Promise<DetalleVentaPublica & { mandado?: boolean }> {
    const armado = normalizarRenglones(dto.renglones);
    if ('error' in armado) throw new BadRequestException(armado.error);
    const mandado = await conPedido(async () => {
      const creado = await this.pedidos.crearPresupuesto(
        user.id,
        id,
        { ...armado, estimativo: dto.estimativo, detalleAlCliente: dto.detalleAlCliente, nota: dto.nota ?? null },
        'dueno',
      );
      if (!creado) throw new NotFoundException('No hay un pedido a medida con ese id.');
      if (!dto.enviar) return undefined;
      const enviado = await this.pedidos.enviarPresupuesto(user.id, id, creado.presupuesto.id, {
        autor: 'dueno',
        mandarAlCliente: true,
      });
      return enviado?.mandado;
    });
    return { ...(await this.detalle(user.id, id)), ...(mandado === undefined ? {} : { mandado }) };
  }

  /** Habilita un borrador (del dueño o del asistente) y se lo manda al cliente por su chat. */
  @Post(':id/presupuestos/:presupuestoId/enviar')
  @UseGuards(JwtAuthGuard)
  async enviarPresupuesto(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('presupuestoId') presupuestoId: string,
  ): Promise<DetalleVentaPublica & { mandado: boolean }> {
    const resultado = await conPedido(() =>
      this.pedidos.enviarPresupuesto(user.id, id, presupuestoId, { autor: 'dueno', mandarAlCliente: true }),
    );
    if (!resultado) throw new NotFoundException('No hay un presupuesto con ese id.');
    return { ...(await this.detalle(user.id, id)), mandado: resultado.mandado };
  }

  @Post(':id/presupuestos/:presupuestoId/descartar')
  @UseGuards(JwtAuthGuard)
  async descartarPresupuesto(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('presupuestoId') presupuestoId: string,
  ): Promise<DetalleVentaPublica> {
    if (!(await this.pedidos.descartarPresupuesto(user.id, id, presupuestoId))) {
      throw new NotFoundException('No hay un borrador con ese id.');
    }
    return this.detalle(user.id, id);
  }

  /** Genera el cobro del presupuesto vigente (link de Mercado Pago o a coordinar) sin esperar al cliente. */
  @Post(':id/cobrar')
  @UseGuards(JwtAuthGuard)
  async cobrar(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CobrarDto): Promise<DetalleVentaPublica> {
    await conPedido(() => this.pedidos.cobrar(user.id, id, { autor: 'dueno', medioPago: dto.medioPago }));
    return this.detalle(user.id, id);
  }

  private async detalle(userId: string, id: string): Promise<DetalleVentaPublica> {
    const venta = await this.pedidos.detalle(userId, id);
    if (!venta) throw new NotFoundException('No existe esa venta.');
    return aDetalleVentaPublica(venta);
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
  async marcarPagada(@CurrentUser() user: User, @Param('id') id: string): Promise<DetalleVentaPublica> {
    const venta = await this.ventas.marcarPagadaPorElDueno(user.id, id);
    if (!venta) throw new NotFoundException('No hay un pedido pendiente con ese id.');
    return this.detalle(user.id, id);
  }

  @Post(':id/cancelar')
  @UseGuards(JwtAuthGuard)
  async cancelar(@CurrentUser() user: User, @Param('id') id: string): Promise<DetalleVentaPublica> {
    const venta = await this.ventas.cancelar(user.id, id);
    if (!venta) throw new NotFoundException('No hay un pedido pendiente con ese id.');
    return this.detalle(user.id, id);
  }
}
