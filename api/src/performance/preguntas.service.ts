import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterClient, resumenDeError } from '../agents/openrouter.client.js';
import { aMensajesPublicos } from '../comercio/ventas.types.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  armarPedidoDeClasificacion,
  HORAS_PARA_CLASIFICAR,
  leerClasificacion,
  MAX_MENSAJES_A_CLASIFICAR,
  mensajesParaClasificar,
} from './preguntas.rules.js';

/** Cada cuánto se buscan chats para clasificar. */
const CADA_MS = 10 * 60 * 1000;
/** Chats por pasada: cada uno es un llamado al modelo. */
export const POR_BARRIDO = 20;

/**
 * Clasifica las preguntas de los chats de ventas (LAU-30) con un solo
 * llamado al modelo por chat, cuando el chat quedó quieto o ya pagó.
 * `clasificadaAt` se reserva de forma atómica antes de llamar, así dos
 * pasadas nunca mandan el mismo chat dos veces; si el llamado falla, no se
 * reintenta (queda sin clasificar). Se le manda sólo el texto del chat,
 * saneado, con la política de proveedor de siempre; los logs llevan ids.
 * `setInterval` y réplica única, como ConciliacionService.
 */
@Injectable()
export class PreguntasPerformanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreguntasPerformanceService.name);
  private timer?: NodeJS.Timeout;
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.barrer(), CADA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Una pasada. Devuelve cuántos chats clasificó. `soloDe` acota a esas
   * cuentas (los tests comparten la base y corren en paralelo).
   */
  async barrer(ahora: Date = new Date(), soloDe?: string[]): Promise<number> {
    if (this.corriendo || !this.config.get('OPENROUTER_API_KEY', { infer: true })) return 0;
    this.corriendo = true;
    try {
      const candidatos = await this.prisma.etapaChat.findMany({
        where: {
          clasificadaAt: null,
          conversationId: { not: null },
          ...(soloDe ? { userId: { in: soloDe } } : {}),
          OR: [{ etapa: 'pagado' }, { ultimaActividadAt: { lt: new Date(ahora.getTime() - HORAS_PARA_CLASIFICAR * 60 * 60 * 1000) } }],
        },
        orderBy: { ultimaActividadAt: 'asc' },
        take: POR_BARRIDO,
        select: { id: true },
      });
      let clasificados = 0;
      for (const { id } of candidatos) {
        if (await this.clasificar(id, ahora)) clasificados += 1;
      }
      if (clasificados > 0) this.logger.log(`Performance: ${clasificados} ${clasificados === 1 ? 'chat' : 'chats'} con sus preguntas clasificadas.`);
      return clasificados;
    } catch (error) {
      this.logger.error(`Falló el barrido de preguntas: ${resumenDeError(error)}`);
      return 0;
    } finally {
      this.corriendo = false;
    }
  }

  /** Un chat. False si otro ya lo había tomado o si no se pudo clasificar. */
  private async clasificar(etapaChatId: string, ahora: Date): Promise<boolean> {
    const reserva = await this.prisma.etapaChat.updateMany({
      where: { id: etapaChatId, clasificadaAt: null, conversationId: { not: null } },
      data: { clasificadaAt: ahora },
    });
    if (reserva.count !== 1) return false;
    try {
      const etapaChat = await this.prisma.etapaChat.findUniqueOrThrow({
        where: { id: etapaChatId },
        select: { userId: true, conversationId: true, etapa: true },
      });
      // La retención pudo desligarlo entre la reserva y acá: sin conversación no hay nada que leer.
      const conversationId = etapaChat.conversationId;
      if (!conversationId) return false;
      const [filas, intereses] = await Promise.all([
        this.prisma.message.findMany({
          where: { conversationId, conversation: { userId: etapaChat.userId }, role: { in: ['user', 'assistant'] } },
          select: { role: true, content: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: MAX_MENSAJES_A_CLASIFICAR * 2,
        }),
        this.prisma.interesProducto.findMany({
          where: { conversationId, userId: etapaChat.userId },
          select: { producto: { select: { id: true, nombre: true, userId: true } } },
        }),
      ]);
      const mensajes = mensajesParaClasificar(aMensajesPublicos(filas.reverse()));
      if (!mensajes.some((mensaje) => mensaje.de === 'cliente')) return false;

      const productos = new Map(
        intereses
          .filter(({ producto }) => producto.userId === etapaChat.userId)
          .map(({ producto }) => [producto.id, { id: producto.id, nombre: producto.nombre }]),
      );
      const respuesta = await this.openRouter.chat({
        messages: armarPedidoDeClasificacion(mensajes, [...productos.values()]),
        reasoning: { enabled: false },
        maxTokens: 1500,
      });
      const preguntas = leerClasificacion(respuesta.content, new Set(productos.keys()));
      if (preguntas === null) {
        this.logger.warn(`El modelo no devolvió una clasificación legible para el chat ${etapaChatId}.`);
        return false;
      }
      if (preguntas.length > 0) {
        await this.prisma.preguntaChat.createMany({
          data: preguntas.map((pregunta) => ({ ...pregunta, userId: etapaChat.userId, etapaChatId, etapa: etapaChat.etapa })),
        });
      }
      return true;
    } catch (error) {
      this.logger.error(`No se pudieron clasificar las preguntas del chat ${etapaChatId}: ${resumenDeError(error)}`);
      return false;
    }
  }
}
