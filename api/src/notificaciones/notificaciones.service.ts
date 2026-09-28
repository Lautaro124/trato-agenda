import { Injectable, Logger } from '@nestjs/common';
import type { Notificacion } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { textoParaWhatsapp, type Aviso } from './avisos.js';

/** Cómo le llega un aviso al dueño fuera del panel. Lo registra WhatsappModule al arrancar. */
export type CanalPropio = (userId: string, texto: string) => Promise<boolean>;

/**
 * Cómo le llega un mensaje a un cliente del negocio (el chat de WhatsApp de
 * donde salió el pedido), por el número del dueño. También lo registra WhatsappModule.
 */
export type CanalCliente = (userId: string, remoteJid: string, texto: string) => Promise<boolean>;

export const POR_PAGINA = 20;

/** Cada cuánto como mucho una misma conversación puede derivarle una consulta al dueño. */
export const HORAS_ENTRE_CONSULTAS = 6;

export type ListadoNotificaciones = {
  notificaciones: Notificacion[];
  total: number;
  noLeidas: number;
  pagina: number;
  porPagina: number;
};

/**
 * Avisos al dueño. Siempre quedan en la base (la campanita del panel) y, si
 * hay un canal registrado y WhatsApp está vinculado, también le llegan a su
 * propio chat. Mandarlo por WhatsApp es best effort: si falla, el aviso
 * igual está en el panel.
 *
 * El canal se registra desde afuera (whatsapp/avisos-por-whatsapp.ts) para
 * que este módulo no dependa de WhatsappModule: WhatsApp depende de la
 * conversación, la conversación del comercio y el comercio de los avisos.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  private canal: CanalPropio | null = null;
  private canalCliente: CanalCliente | null = null;

  constructor(private readonly prisma: PrismaService) {}

  usarCanal(canal: CanalPropio): void {
    this.canal = canal;
  }

  usarCanalCliente(canal: CanalCliente): void {
    this.canalCliente = canal;
  }

  /**
   * Un mensaje del negocio al chat de un cliente (por ejemplo, que su pago se
   * aprobó). Best effort como el aviso al dueño: false si no hay canal, si no
   * hay WhatsApp vinculado o si falló, y nunca lanza.
   */
  async avisarAlCliente(userId: string, remoteJid: string, texto: string): Promise<boolean> {
    if (!this.canalCliente) return false;
    try {
      return await this.canalCliente(userId, remoteJid, texto);
    } catch (error) {
      this.logger.warn(`No se pudo mandar el mensaje al cliente de ${userId}: ${(error as Error).message}`);
      return false;
    }
  }

  /** Guarda el aviso y lo manda. null si ya había uno igual sin leer (misma clave). */
  async avisar(userId: string, aviso: Aviso): Promise<Notificacion | null> {
    if (aviso.clave) {
      const pendiente = await this.prisma.notificacion.findFirst({
        where: { userId, clave: aviso.clave, leidaAt: null },
        select: { id: true },
      });
      if (pendiente) return null;
    }
    const notificacion = await this.prisma.notificacion.create({
      data: {
        userId,
        tipo: aviso.tipo,
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        enlace: aviso.enlace ?? null,
        clave: aviso.clave ?? null,
      },
    });
    if (this.canal) {
      await this.canal(userId, textoParaWhatsapp(aviso)).catch((error: unknown) =>
        this.logger.warn(`No se pudo mandar el aviso por WhatsApp a ${userId}: ${(error as Error).message}`),
      );
    }
    return notificacion;
  }

  /**
   * true si esta conversación ya derivó una consulta hace menos de
   * HORAS_ENTRE_CONSULTAS: un cliente insistente no le llena el chat al dueño.
   */
  async consultaRecienteDe(userId: string, conversationId: string, ahora: Date = new Date()): Promise<boolean> {
    const desde = new Date(ahora.getTime() - HORAS_ENTRE_CONSULTAS * 60 * 60 * 1000);
    const reciente = await this.prisma.notificacion.findFirst({
      where: { userId, clave: `consulta:${conversationId}`, createdAt: { gt: desde } },
      select: { id: true },
    });
    return reciente !== null;
  }

  async listar(userId: string, pagina = 1): Promise<ListadoNotificaciones> {
    const [notificaciones, total, noLeidas] = await Promise.all([
      this.prisma.notificacion.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
      this.prisma.notificacion.count({ where: { userId } }),
      this.noLeidas(userId),
    ]);
    return { notificaciones, total, noLeidas, pagina, porPagina: POR_PAGINA };
  }

  noLeidas(userId: string): Promise<number> {
    return this.prisma.notificacion.count({ where: { userId, leidaAt: null } });
  }

  async marcarLeida(userId: string, id: string, ahora: Date = new Date()): Promise<boolean> {
    const { count } = await this.prisma.notificacion.updateMany({
      where: { id, userId, leidaAt: null },
      data: { leidaAt: ahora },
    });
    return count > 0;
  }

  async marcarTodas(userId: string, ahora: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.notificacion.updateMany({
      where: { userId, leidaAt: null },
      data: { leidaAt: ahora },
    });
    return count;
  }
}
