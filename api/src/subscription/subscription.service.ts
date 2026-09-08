import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Subscription, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MercadoPagoClient, type PreapprovalStatus } from './mercadopago.client.js';
import { estadoDeSuscripcion, type EstadoSuscripcion } from './subscription.rules.js';
import { aSuscripcionPublica, type SuscripcionPublica } from './subscription.types.js';

/** Texto que la persona ve en el checkout y en su resumen de Mercado Pago. */
const RAZON = 'Trato Agenda — plan mensual';

/** Mercado Pago habla de preapprovals; nosotros de suscripciones. */
const ESTADO_POR_STATUS: Record<PreapprovalStatus, string> = {
  pending: 'pendiente',
  authorized: 'activa',
  paused: 'pausada',
  cancelled: 'cancelada',
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Estado combinado de prueba + suscripción, tal como lo consume el frontend. */
  async estadoPublico(userId: string): Promise<SuscripcionPublica> {
    const { estado, suscripcion } = await this.resolver(userId);
    return aSuscripcionPublica(estado, suscripcion, this.precio());
  }

  /**
   * Único booleano que mira el runtime conversacional: false apaga al asistente
   * sin tocar la sesión de WhatsApp ni los datos del dueño.
   */
  async asistenteActivo(userId: string): Promise<boolean> {
    const { estado } = await this.resolver(userId);
    return estado.asistenteActivo;
  }

  /**
   * Arranca la suscripción en Mercado Pago y devuelve la URL a la que hay que
   * mandar el browser. El cobro es inmediato: quien se suscribe antes de que
   * termine la prueba resigna los días que le quedaban.
   */
  async crearCheckout(user: User): Promise<{ initPoint: string }> {
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const monto = this.precio();

    const preapproval = await this.mercadoPago.crearPreapproval({
      reason: RAZON,
      externalReference: user.id,
      payerEmail: user.email,
      backUrl: `${frontendUrl}/plan?volviendo=1`,
      montoPorMes: monto,
      moneda: 'ARS',
    });

    if (!preapproval.init_point) {
      throw new Error('Mercado Pago no devolvió init_point para el preapproval.');
    }

    const datos = {
      estado: ESTADO_POR_STATUS[preapproval.status],
      mpPreapprovalId: preapproval.id,
      mpStatus: preapproval.status,
      montoCentavos: Math.round(monto * 100),
      moneda: 'ARS',
      canceladaAt: null,
    };
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...datos },
      update: datos,
    });

    return { initPoint: preapproval.init_point };
  }

  /**
   * Aplica lo que diga Mercado Pago sobre un preapproval. No lee el estado del
   * cuerpo del webhook: lo vuelve a pedir, porque el webhook llega repetido y
   * desordenado. Es idempotente — la llave es el mpPreapprovalId.
   */
  async sincronizarDesdeMp(preapprovalId: string): Promise<void> {
    const preapproval = await this.mercadoPago.obtenerPreapproval(preapprovalId);
    const userId = preapproval.external_reference;
    if (!userId) {
      this.logger.warn(`Preapproval ${preapprovalId} sin external_reference: no sé de qué usuario es.`);
      return;
    }

    const estado = ESTADO_POR_STATUS[preapproval.status];
    const proximoCobroAt = preapproval.next_payment_date
      ? new Date(preapproval.next_payment_date)
      : null;
    const datos = {
      estado,
      mpPreapprovalId: preapproval.id,
      mpStatus: preapproval.status,
      proximoCobroAt,
      ...(estado === 'activa' ? { ultimoPagoAt: new Date(), canceladaAt: null } : {}),
      ...(estado === 'cancelada' ? { canceladaAt: new Date() } : {}),
    };

    await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, montoCentavos: Math.round(this.precio() * 100), moneda: 'ARS', ...datos },
      update: datos,
    });

    this.logger.log(`Suscripción de ${userId} quedó en "${estado}" (preapproval ${preapproval.id}).`);
  }

  async cancelar(userId: string): Promise<SuscripcionPublica> {
    const suscripcion = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!suscripcion?.mpPreapprovalId) {
      throw new NotFoundException('No hay una suscripción de Mercado Pago para cancelar.');
    }

    await this.mercadoPago.cancelarPreapproval(suscripcion.mpPreapprovalId);
    await this.prisma.subscription.update({
      where: { userId },
      data: { estado: 'cancelada', mpStatus: 'cancelled', canceladaAt: new Date() },
    });

    return this.estadoPublico(userId);
  }

  private async resolver(
    userId: string,
  ): Promise<{ estado: EstadoSuscripcion; suscripcion: Subscription | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { suscripcion: true },
    });
    if (!user) {
      throw new NotFoundException('El usuario no existe.');
    }

    return {
      estado: estadoDeSuscripcion({ creadoEl: user.createdAt, suscripcion: user.suscripcion }),
      suscripcion: user.suscripcion,
    };
  }

  private precio(): number {
    return this.config.get('SUSCRIPCION_PRECIO_ARS', { infer: true });
  }
}
