import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { ItemVenta, Prisma, Venta } from '../generated/prisma/client.js';
import { avisoMercadoPagoDesconectado, avisoPedidoManual, avisoStock, avisoVentaPagada } from '../notificaciones/avisos.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MercadoPagoClient,
  MercadoPagoError,
  MercadoPagoNoAutorizadoError,
  type PagoMp,
} from '../subscription/mercadopago.client.js';
import { describirStock, hayStock, stockBajo } from './catalogo.rules.js';
import { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { reservadasPorVariante } from './reservas.js';
import {
  agruparItems,
  MAX_PEDIDOS_PENDIENTES,
  pagoSaldaVenta,
  problemaDeForma,
  telefonoDeJid,
  vencimientoDeReserva,
  type ItemPedido,
  type MedioDePago,
} from './ventas.rules.js';

/** Un motivo de negocio para no crear el pedido, con el texto listo para el modelo o el panel. */
export class PedidoRechazadoError extends Error {}

export type VentaConItems = Venta & { items: ItemVenta[] };

export type CrearPedidoInput = {
  userId: string;
  conversationId: string | null;
  remoteJid: string | null;
  nombreCliente: string;
  items: ItemPedido[];
  medioPago: MedioDePago;
  /** Pedido del banco de pruebas del Home: real, pero fuera del histórico. */
  dePrueba?: boolean;
  ahora?: Date;
};

/** Una variante que quedó en o por debajo de su mínimo al descontar una venta. */
export type VarianteConStockBajo = {
  varianteId: string;
  sku: string;
  nombreProducto: string;
  nombreVariante: string;
  stock: number;
};

export type ResultadoPago = {
  venta: VentaConItems;
  /** false si ya estaba pagada: la notificación repetida no hace nada. */
  nueva: boolean;
  stockBajo: VarianteConStockBajo[];
};

type Tx = Prisma.TransactionClient;

type VarianteBloqueada = {
  id: string;
  sku: string;
  nombre: string;
  precioCentavos: number;
  stock: number | null;
  disponible: boolean;
  activo: boolean;
  codigo: string;
  nombreProducto: string;
};

/** Ventas de Mercado Pago que la conciliación sigue mirando después de vencida la reserva. */
const HORAS_CONCILIACION = 24;

/**
 * Pedidos y ventas del asistente de ventas. La reserva de stock es una regla
 * (ventas.rules.ts): una venta pendiente y sin vencer retiene sus unidades,
 * y la cuenta se hace sumando esas ventas, no con una tabla aparte.
 *
 * Crear un pedido bloquea (`FOR UPDATE`) las variantes que pide, en orden de
 * id, dentro de una transacción: dos clientes que piden la última unidad al
 * mismo tiempo se serializan y el segundo ve la reserva del primero.
 */
@Injectable()
export class VentasService {
  private readonly logger = new Logger(VentasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoClient,
    private readonly cuentas: CuentaMercadoPagoService,
    private readonly config: ConfigService<Env, true>,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** Unidades retenidas por pedidos pendientes y sin vencer, por variante (ver reservas.ts). */
  reservadasPorVariante(
    varianteIds: string[],
    tx: Tx | PrismaService = this.prisma,
    ahora: Date = new Date(),
  ): Promise<Map<string, number>> {
    return reservadasPorVariante(tx, varianteIds, ahora);
  }

  /**
   * Crea el pedido con su reserva y, si es por Mercado Pago, el link de pago a
   * nombre del comercio. Cualquier motivo de negocio para no crearlo sale
   * como PedidoRechazadoError con un texto que el asistente puede usar.
   */
  async crearPedido(input: CrearPedidoInput): Promise<VentaConItems> {
    const ahora = input.ahora ?? new Date();
    const forma = problemaDeForma(input.items);
    if (forma) throw new PedidoRechazadoError(forma);
    const nombreCliente = input.nombreCliente.trim();
    if (!nombreCliente) throw new PedidoRechazadoError('Falta el nombre de la persona: preguntáselo antes.');

    const token = input.medioPago === 'mercadopago' ? await this.cuentas.tokenDe(input.userId) : null;
    if (input.medioPago === 'mercadopago' && !token) {
      throw new PedidoRechazadoError(
        'El negocio todavía no conectó Mercado Pago, así que no hay link de pago. Ofrecé el pedido a coordinar con el negocio (medioPago "manual").',
      );
    }

    const items = agruparItems(input.items);
    const venta = await this.prisma.$transaction((tx) => this.reservar(tx, input, items, nombreCliente, ahora));

    if (token) {
      try {
        const preferencia = await this.mp.crearPreferencia(token.accessToken, {
          items: venta.items.map((item) => ({
            id: item.varianteId ?? item.codigo,
            title: `${item.nombreProducto}${item.nombreVariante ? ` - ${item.nombreVariante}` : ''}`.slice(0, 250),
            quantity: item.cantidad,
            unit_price: item.precioUnitarioCentavos / 100,
            currency_id: venta.moneda,
          })),
          externalReference: venta.id,
          notificationUrl: `${this.config.get('API_PUBLIC_URL', { infer: true })}/ventas/webhook?venta=${venta.id}`,
          venceAt: venta.reservaVenceAt,
        });
        return await this.prisma.venta.update({
          where: { id: venta.id },
          data: { mpPreferenceId: preferencia.id, linkPago: preferencia.init_point },
          include: { items: true },
        });
      } catch (error) {
        // Sin link no hay forma de pagar: se libera la reserva en el acto.
        await this.prisma.venta.update({ where: { id: venta.id }, data: { estado: 'cancelada', canceladaAt: ahora } });
        if (error instanceof MercadoPagoNoAutorizadoError) await this.desconectarPorRevocacion(input.userId);
        this.logger.error(`No se pudo crear el link de pago de la venta ${venta.id}: ${(error as Error).message}`);
        throw new PedidoRechazadoError(
          'No se pudo generar el link de pago de Mercado Pago. Ofrecé el pedido a coordinar con el negocio (medioPago "manual").',
        );
      }
    }
    // Un pedido a cobrar a mano no avanza solo: el dueño tiene que enterarse.
    await this.avisar(input.userId, avisoPedidoManual(venta));
    return venta;
  }

  private async reservar(
    tx: Tx,
    input: CrearPedidoInput,
    items: ItemPedido[],
    nombreCliente: string,
    ahora: Date,
  ): Promise<VentaConItems> {
    const ids = items.map((item) => item.varianteId).sort();
    // Orden fijo de bloqueo (por id): dos pedidos con las mismas variantes no se traban entre sí.
    const variantes = await tx.$queryRaw<VarianteBloqueada[]>`
      SELECT v."id", v."sku", v."nombre", v."precioCentavos", v."stock", v."disponible", v."activo",
             p."codigo", p."nombre" AS "nombreProducto"
      FROM "Variante" v JOIN "Producto" p ON p."id" = v."productoId"
      WHERE v."id" = ANY(${ids}) AND p."userId" = ${input.userId} AND p."activo" AND v."activo"
      ORDER BY v."id"
      FOR UPDATE OF v
    `;
    const porId = new Map(variantes.map((variante) => [variante.id, variante]));
    if (items.some((item) => !porId.has(item.varianteId))) {
      throw new PedidoRechazadoError(
        'Alguno de los productos ya no está en el catálogo (o el id de variante no es de una búsqueda). Volvé a buscarlo.',
      );
    }

    if (input.conversationId) {
      const pendientes = await tx.venta.count({
        where: { conversationId: input.conversationId, estado: 'pendiente_pago', reservaVenceAt: { gt: ahora } },
      });
      if (pendientes >= MAX_PEDIDOS_PENDIENTES) {
        throw new PedidoRechazadoError(
          `Este cliente ya tiene ${pendientes} pedidos sin pagar. Que pague o cancele alguno antes de hacer otro.`,
        );
      }
    }

    const reservadas = await this.reservadasPorVariante(ids, tx, ahora);
    for (const item of items) {
      const variante = porId.get(item.varianteId) as VarianteBloqueada;
      if (!hayStock(variante, item.cantidad, reservadas.get(variante.id) ?? 0)) {
        const nombre = `${variante.nombreProducto}${variante.nombre ? ` (${variante.nombre})` : ''}`;
        throw new PedidoRechazadoError(
          `No hay stock suficiente de ${JSON.stringify(nombre)} para ${item.cantidad} unidades: ` +
            `${describirStock(variante, reservadas.get(variante.id) ?? 0)}.`,
        );
      }
    }

    const renglones = items.map((item) => {
      const variante = porId.get(item.varianteId) as VarianteBloqueada;
      return {
        varianteId: variante.id,
        codigo: variante.codigo,
        nombreProducto: variante.nombreProducto,
        nombreVariante: variante.nombre,
        precioUnitarioCentavos: variante.precioCentavos,
        cantidad: item.cantidad,
        subtotalCentavos: variante.precioCentavos * item.cantidad,
      };
    });

    const venta = await tx.venta.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        nombreCliente,
        telefonoCliente: input.remoteJid ? telefonoDeJid(input.remoteJid) : null,
        estado: 'pendiente_pago',
        medioPago: input.medioPago,
        totalCentavos: renglones.reduce((suma, renglon) => suma + renglon.subtotalCentavos, 0),
        reservaVenceAt: vencimientoDeReserva(input.medioPago, ahora),
        dePrueba: input.dePrueba ?? false,
        items: { create: renglones },
      },
      include: { items: true },
    });
    if (input.conversationId) {
      // Igual que con los turnos: el nombre se pregunta una vez por conversación.
      await tx.conversation.update({ where: { id: input.conversationId }, data: { nombreCliente } });
    }
    return venta;
  }

  /** Una venta del dueño, o null si no existe o es de otro. */
  buscarDelDueno(userId: string, ventaId: string): Promise<VentaConItems | null> {
    return this.prisma.venta.findFirst({ where: { id: ventaId, userId }, include: { items: true } });
  }

  /** Los pedidos más recientes de una conversación, para `consultar_pedido`. */
  pedidosDeConversacion(conversationId: string, limite = 3): Promise<VentaConItems[]> {
    return this.prisma.venta.findMany({
      where: { conversationId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  /** Cancela el pedido pendiente más reciente de la conversación (el cliente se arrepintió). */
  async cancelarUltimoPendiente(conversationId: string, ahora: Date = new Date()): Promise<VentaConItems | null> {
    const venta = await this.prisma.venta.findFirst({
      where: { conversationId, estado: 'pendiente_pago' },
      orderBy: { createdAt: 'desc' },
    });
    if (!venta) return null;
    return this.cancelar(venta.userId, venta.id, ahora);
  }

  /** Cancela un pedido sin pagar del dueño. null si no existe, no es suyo o ya no se puede cancelar. */
  async cancelar(userId: string, ventaId: string, ahora: Date = new Date()): Promise<VentaConItems | null> {
    const { count } = await this.prisma.venta.updateMany({
      where: { id: ventaId, userId, estado: { in: ['pendiente_pago', 'vencida'] } },
      data: { estado: 'cancelada', canceladaAt: ahora },
    });
    if (count === 0) return null;
    return this.prisma.venta.findUnique({ where: { id: ventaId }, include: { items: true } });
  }

  /**
   * Pasa una venta a pagada y descuenta el stock. Idempotente: una venta ya
   * pagada no se toca (el webhook de Mercado Pago llega repetido). Si la
   * reserva había vencido y otro compró lo último, la venta queda pagada igual
   * —la plata ya entró— y marcada `sinStockAlPagar` para que el dueño resuelva.
   */
  async marcarPagada(
    ventaId: string,
    opciones: { mpPaymentId?: string; ahora?: Date } = {},
  ): Promise<ResultadoPago | null> {
    const ahora = opciones.ahora ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const [bloqueada] = await tx.$queryRaw<Array<{ id: string; estado: string }>>`
        SELECT "id", "estado" FROM "Venta" WHERE "id" = ${ventaId} FOR UPDATE
      `;
      if (!bloqueada) return null;
      if (bloqueada.estado === 'pagada') {
        const venta = await tx.venta.findUniqueOrThrow({ where: { id: ventaId }, include: { items: true } });
        return { venta, nueva: false, stockBajo: [] };
      }

      const items = await tx.itemVenta.findMany({ where: { ventaId } });
      let sinStock = false;
      const conStockBajo: VarianteConStockBajo[] = [];
      for (const item of items) {
        if (!item.varianteId) continue;
        const [descontada] = await tx.$queryRaw<Array<{ stock: number; stockMinimo: number | null }>>`
          UPDATE "Variante" SET "stock" = "stock" - ${item.cantidad}
          WHERE "id" = ${item.varianteId} AND "stock" IS NOT NULL AND "stock" >= ${item.cantidad}
          RETURNING "stock", "stockMinimo"
        `;
        let resultado = descontada;
        if (!resultado) {
          // O no controla cantidad (stock null, no hay nada que descontar) o no alcanzó.
          const [faltante] = await tx.$queryRaw<Array<{ stock: number; stockMinimo: number | null }>>`
            UPDATE "Variante" SET "stock" = 0
            WHERE "id" = ${item.varianteId} AND "stock" IS NOT NULL
            RETURNING "stock", "stockMinimo"
          `;
          if (faltante) sinStock = true;
          resultado = faltante;
        }
        if (resultado && stockBajo({ stock: resultado.stock, stockMinimo: resultado.stockMinimo ?? 0 })) {
          conStockBajo.push({
            varianteId: item.varianteId,
            sku: item.codigo,
            nombreProducto: item.nombreProducto,
            nombreVariante: item.nombreVariante,
            stock: resultado.stock,
          });
        }
      }

      const venta = await tx.venta.update({
        where: { id: ventaId },
        data: {
          estado: 'pagada',
          pagadaAt: ahora,
          sinStockAlPagar: sinStock,
          ...(opciones.mpPaymentId ? { mpPaymentId: opciones.mpPaymentId } : {}),
        },
        include: { items: true },
      });
      return { venta, nueva: true, stockBajo: conStockBajo };
    });
  }

  /**
   * Una notificación de Mercado Pago sobre un pago. No se confía en nada de lo
   * que trae: se vuelve a pedir el pago con el token del comercio dueño de la
   * venta, y sólo si ese pago la salda (aprobado, misma venta, mismo monto y
   * moneda) se marca pagada.
   */
  async procesarPago(paymentId: string, ventaIdSugerida: string | undefined): Promise<ResultadoPago | null> {
    if (!ventaIdSugerida) return null;
    const venta = await this.prisma.venta.findUnique({ where: { id: ventaIdSugerida } });
    if (!venta || venta.medioPago !== 'mercadopago' || venta.estado === 'pagada') return null;

    const token = await this.cuentas.tokenDe(venta.userId);
    if (!token) return null;
    const pago = await this.mp.obtenerPago(token.accessToken, paymentId);
    return this.aplicarPago(venta, pago);
  }

  /** El dueño cobró por fuera. Sólo pedidos propios sin pagar; avisa el stock, no la venta (la marcó él). */
  async marcarPagadaPorElDueno(userId: string, ventaId: string): Promise<VentaConItems | null> {
    const venta = await this.buscarDelDueno(userId, ventaId);
    if (!venta || !['pendiente_pago', 'vencida'].includes(venta.estado)) return null;
    const resultado = await this.marcarPagada(ventaId);
    if (!resultado) return null;
    await this.avisarStock(userId, resultado);
    return resultado.venta;
  }

  private async aplicarPago(venta: Venta, pago: PagoMp): Promise<ResultadoPago | null> {
    if (!pagoSaldaVenta(pago, venta)) return null;
    const resultado = await this.marcarPagada(venta.id, { mpPaymentId: String(pago.id) });
    if (resultado?.nueva) {
      await this.avisar(venta.userId, avisoVentaPagada(resultado.venta));
      await this.avisarStock(venta.userId, resultado);
    }
    return resultado;
  }

  private async avisarStock(userId: string, resultado: ResultadoPago): Promise<void> {
    for (const variante of resultado.stockBajo) await this.avisar(userId, avisoStock(variante));
  }

  /** Mercado Pago dejó de aceptar el token del comercio: se desconecta y se le avisa. */
  private async desconectarPorRevocacion(userId: string): Promise<void> {
    await this.cuentas.desconectar(userId);
    await this.avisar(userId, avisoMercadoPagoDesconectado());
  }

  /** Un aviso que falla no tira abajo la venta: queda logueado y sigue. */
  private async avisar(userId: string, aviso: Parameters<NotificacionesService['avisar']>[1]): Promise<void> {
    try {
      await this.notificaciones.avisar(userId, aviso);
    } catch (error) {
      this.logger.error(`No se pudo guardar el aviso ${aviso.tipo} para ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Red de seguridad del webhook: busca en Mercado Pago los pagos de las ventas
   * que siguen sin pagar (hasta un día después de vencida la reserva). Así un
   * webhook perdido o mal firmado no deja una venta cobrada sin registrar.
   */
  async conciliar(ahora: Date = new Date()): Promise<ResultadoPago[]> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        medioPago: 'mercadopago',
        estado: { in: ['pendiente_pago', 'vencida'] },
        reservaVenceAt: { gt: new Date(ahora.getTime() - HORAS_CONCILIACION * 60 * 60 * 1000) },
        mpPreferenceId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    const cobradas: ResultadoPago[] = [];
    for (const venta of ventas) {
      try {
        const token = await this.cuentas.tokenDe(venta.userId);
        if (!token) continue;
        const pagos = await this.mp.buscarPagos(token.accessToken, venta.id);
        const saldo = pagos.find((pago) => pagoSaldaVenta(pago, venta));
        if (!saldo) continue;
        const resultado = await this.aplicarPago(venta, saldo);
        if (resultado?.nueva) cobradas.push(resultado);
      } catch (error) {
        if (error instanceof MercadoPagoNoAutorizadoError) {
          await this.desconectarPorRevocacion(venta.userId);
        } else if (!(error instanceof MercadoPagoError)) {
          throw error;
        }
        this.logger.warn(`No se pudo conciliar la venta ${venta.id}: ${(error as Error).message}`);
      }
    }
    return cobradas;
  }

  /** Marca como vencidas las pendientes pasadas de hora. Es sólo para mostrar: la reserva ya no cuenta igual. */
  async vencerReservas(ahora: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.venta.updateMany({
      where: { estado: 'pendiente_pago', reservaVenceAt: { lte: ahora } },
      data: { estado: 'vencida' },
    });
    return count;
  }
}
