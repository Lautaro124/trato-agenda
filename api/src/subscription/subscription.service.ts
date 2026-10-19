import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Subscription, User } from '../generated/prisma/client.js';
import { resumenDeError } from '../agents/openrouter.client.js';
import { avisoCupoDeChats } from '../notificaciones/avisos.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MercadoPagoClient, type Preapproval, type PreapprovalStatus } from './mercadopago.client.js';
import {
  PLANES,
  IDS_DE_PLAN,
  estadoDeCupo,
  estadoDeSuscripcion,
  limiteDeChats,
  rangoDelMes,
  type EstadoSuscripcion,
  type PlanId,
} from './subscription.rules.js';
import { aSuscripcionPublica, type PrecioPublico, type SuscripcionPublica } from './subscription.types.js';

/** Prefijo del JID del chat de prueba del dueño (ver jidDePrueba en conversation.service.ts): no es un cliente. */
const PREFIJO_JID_DE_PRUEBA = 'web-test:';

/** Texto que la persona ve en el checkout y en su resumen de Mercado Pago. */
const razonDelPlan = (plan: PlanId): string => `Trato — plan ${PLANES[plan].nombre}`;

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
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** Estado combinado de prueba + suscripción, tal como lo consume el frontend. */
  async estadoPublico(userId: string): Promise<SuscripcionPublica> {
    const { estado, suscripcion } = await this.resolver(userId);
    const chats = await this.chatsDelMes(userId);
    const limite = limiteDeChats(estado.estado === 'activa' ? suscripcion?.plan : null);
    return aSuscripcionPublica(estado, suscripcion, this.precio('basico'), { chats, limite });
  }

  /** Los precios de los planes, sin sesión: la landing los lee de acá para no hardcodearlos. */
  precioPublico(): PrecioPublico {
    return {
      moneda: 'ARS',
      planes: IDS_DE_PLAN.map((id) => ({
        id,
        nombre: PLANES[id].nombre,
        chats: PLANES[id].chats,
        monto: this.precio(id),
      })),
    };
  }

  /**
   * Chats del mes en curso: clientes distintos (Conversation) con al menos un
   * mensaje entrante desde el 1° (hora argentina). El chat de prueba del dueño
   * no cuenta.
   */
  async chatsDelMes(userId: string, ahora: Date = new Date()): Promise<number> {
    const { desde, hasta } = rangoDelMes(ahora);
    const [fila] = await this.prisma.$queryRaw<Array<{ chats: bigint }>>`
      SELECT COUNT(DISTINCT m."conversationId") AS chats
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."userId" = ${userId}
        AND m."role" = 'user'
        AND m."createdAt" >= ${desde}
        AND m."createdAt" < ${hasta}
        AND c."remoteJid" NOT LIKE ${`${PREFIJO_JID_DE_PRUEBA}%`}
    `;
    return Number(fila?.chats ?? 0);
  }

  /**
   * Avisa una vez por mes al llegar al 80 % y al 100 % del tope del plan. Sólo
   * informa: nunca frena al asistente. Best effort — quien llama no espera el
   * resultado ni le importa si falla.
   */
  async avisarSiLlegaAlTope(userId: string, ahora: Date = new Date()): Promise<void> {
    const { estado, suscripcion } = await this.resolver(userId);
    const plan = estado.estado === 'activa' ? (suscripcion?.plan ?? null) : null;
    const cupo = estadoDeCupo({ usados: await this.chatsDelMes(userId, ahora), plan });
    if (!cupo.cercano) return;

    const aviso = avisoCupoDeChats({
      plan,
      usados: cupo.usados,
      limite: cupo.limite,
      superado: cupo.superado,
      etiquetaMes: rangoDelMes(ahora).etiqueta,
    });
    // Una vez por mes y umbral aunque el dueño ya lo haya leído (la dedupe de
    // `avisar` sólo cubre los no leídos).
    const yaAvisado = await this.prisma.notificacion.findFirst({
      where: { userId, clave: aviso.clave },
      select: { id: true },
    });
    if (yaAvisado) return;
    await this.notificaciones.avisar(userId, aviso);
  }

  /**
   * Único booleano que mira el runtime conversacional: false apaga al asistente
   * sin tocar la sesión de WhatsApp ni los datos del dueño.
   */
  private async emailDelPagador(user: User, email?: string): Promise<string> {
    if (user.email) return user.email;
    if (!email) throw new BadRequestException('Falta el email para Mercado Pago.');

    const otro = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (otro && otro.id !== user.id) {
      throw new ConflictException('Ese email ya es de otra cuenta de Trato.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { email } });
    return email;
  }

  async asistenteActivo(userId: string): Promise<boolean> {
    const { estado } = await this.resolver(userId);
    return estado.asistenteActivo;
  }

  /**
   * Arranca la suscripción en Mercado Pago y devuelve la URL a la que hay que
   * mandar el browser. El cobro es inmediato: quien se suscribe antes de que
   * termine la prueba resigna los días que le quedaban.
   *
   * Mercado Pago exige el email de quien paga: una cuenta creada sólo con
   * WhatsApp no lo tiene, así que /plan lo pide y acá queda guardado.
   */
  async crearCheckout(user: User, plan: PlanId, email?: string): Promise<{ initPoint: string }> {
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const monto = this.precio(plan);
    const payerEmail = await this.emailDelPagador(user, email);

    const preapproval = await this.mercadoPago.crearPreapproval({
      reason: razonDelPlan(plan),
      externalReference: user.id,
      payerEmail,
      backUrl: `${frontendUrl}/plan?volviendo=1`,
      montoPorMes: monto,
      moneda: 'ARS',
    });

    if (!preapproval.init_point) {
      throw new Error('Mercado Pago no devolvió init_point para el preapproval.');
    }

    // Con una suscripción vigente, el cambio de plan no toca la fila ni cancela
    // nada: el preapproval nuevo queda pendiente y recién cuando Mercado Pago
    // confirma que se autorizó (sincronizarDesdeMp) se adopta y se cancela el
    // anterior. Así abandonar el pago no deja a nadie sin servicio.
    const anterior = await this.prisma.subscription.findUnique({ where: { userId: user.id } });
    if (anterior?.estado === 'activa' && anterior.mpPreapprovalId) {
      // Un cambio ya pendiente que la persona abandonó y repite: el anterior
      // se cancela para que, si lo autoriza después, no cobre por duplicado.
      await this.cancelarSinFrenar(anterior.mpPreapprovalPendienteId, user.id);
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: { mpPreapprovalPendienteId: preapproval.id, planPendiente: plan },
      });
      return { initPoint: preapproval.init_point };
    }

    // Fila sin suscripción vigente (pausada, pendiente, cancelada): lo que
    // hubiera quedado colgado se cancela antes de pisarlo.
    await this.cancelarSinFrenar(anterior?.mpPreapprovalId, user.id);
    await this.cancelarSinFrenar(anterior?.mpPreapprovalPendienteId, user.id);

    const datos = {
      estado: ESTADO_POR_STATUS[preapproval.status],
      plan,
      mpPreapprovalId: preapproval.id,
      mpStatus: preapproval.status,
      montoCentavos: Math.round(monto * 100),
      moneda: 'ARS',
      canceladaAt: null,
      mpPreapprovalPendienteId: null,
      planPendiente: null,
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

    const fila = await this.prisma.subscription.findUnique({ where: { userId } });
    if (fila && fila.mpPreapprovalPendienteId === preapproval.id) {
      await this.resolverCambioDePlan(userId, fila, preapproval);
      return;
    }
    // Evento de un preapproval que ya no es el vigente (el anterior, cancelado a
    // propósito al cambiar de plan): no pisa la suscripción que sí está pagando.
    if (fila?.estado === 'activa' && fila.mpPreapprovalId && fila.mpPreapprovalId !== preapproval.id) {
      // Si además quedó autorizado (un checkout abandonado que la persona
      // terminó después) cobraría por duplicado: se cancela en vez de ignorarlo.
      if (preapproval.status === 'authorized') await this.cancelarSinFrenar(preapproval.id, userId);
      this.logger.log(`Preapproval ${preapproval.id} ya no es el vigente de ${userId}: no toca la suscripción.`);
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
      create: { userId, montoCentavos: Math.round(this.precio('basico') * 100), moneda: 'ARS', ...datos },
      update: datos,
    });

    this.logger.log(`Suscripción de ${userId} quedó en "${estado}" (preapproval ${preapproval.id}).`);
  }

  /**
   * El preapproval pendiente de un cambio de plan cambió de estado: autorizado
   * → pasa a ser el vigente (plan y monto nuevos) y se cancela el anterior;
   * cancelado → la persona abandonó, la suscripción vigente queda como estaba.
   */
  private async resolverCambioDePlan(userId: string, fila: Subscription, preapproval: Preapproval): Promise<void> {
    if (preapproval.status === 'cancelled') {
      await this.prisma.subscription.update({
        where: { userId },
        data: { mpPreapprovalPendienteId: null, planPendiente: null },
      });
      return;
    }
    if (preapproval.status !== 'authorized') return;

    const plan: PlanId = fila.planPendiente === 'pro' ? 'pro' : 'basico';
    const anteriorId = fila.mpPreapprovalId;
    await this.prisma.subscription.update({
      where: { userId },
      data: {
        estado: 'activa',
        plan,
        mpPreapprovalId: preapproval.id,
        mpStatus: preapproval.status,
        montoCentavos: Math.round(this.precio(plan) * 100),
        proximoCobroAt: preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null,
        ultimoPagoAt: new Date(),
        canceladaAt: null,
        mpPreapprovalPendienteId: null,
        planPendiente: null,
      },
    });
    if (anteriorId && anteriorId !== preapproval.id) await this.cancelarSinFrenar(anteriorId, userId);
    this.logger.log(`Suscripción de ${userId} cambió al plan "${plan}".`);
  }

  async cancelar(userId: string): Promise<SuscripcionPublica> {
    const suscripcion = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!suscripcion?.mpPreapprovalId) {
      throw new NotFoundException('No hay una suscripción de Mercado Pago para cancelar.');
    }

    await this.mercadoPago.cancelarPreapproval(suscripcion.mpPreapprovalId);
    // Un cambio de plan a medio pagar también se baja: si no, autorizarlo después revive la suscripción.
    await this.cancelarSinFrenar(suscripcion.mpPreapprovalPendienteId, userId);
    await this.prisma.subscription.update({
      where: { userId },
      data: {
        estado: 'cancelada',
        mpStatus: 'cancelled',
        canceladaAt: new Date(),
        mpPreapprovalPendienteId: null,
        planPendiente: null,
      },
    });

    return this.estadoPublico(userId);
  }

  /** Cancela un preapproval sobrante en Mercado Pago; si falla, queda en Sentry y no frena al llamador. */
  private async cancelarSinFrenar(preapprovalId: string | null | undefined, userId: string): Promise<void> {
    if (!preapprovalId) return;
    try {
      await this.mercadoPago.cancelarPreapproval(preapprovalId);
    } catch (error) {
      this.logger.error(`No se pudo cancelar el preapproval sobrante de ${userId}: ${resumenDeError(error)}`);
    }
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

  private precio(plan: PlanId): number {
    return plan === 'pro'
      ? this.config.get('SUSCRIPCION_PRECIO_PRO_ARS', { infer: true })
      : this.config.get('SUSCRIPCION_PRECIO_ARS', { infer: true });
  }
}
