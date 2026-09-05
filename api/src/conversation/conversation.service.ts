import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GRAFO_CONVERSACION, type GrafoConversacion } from './conversation.providers.js';
import { LIMITE_RECURSION } from './graph/graph.factory.js';
import { VENTANA_HISTORIAL, mensajesDesdeFilas } from './graph/historial.js';
import {
  MENSAJE_DISCULPA_GENERICO,
  MENSAJE_LOOP_AGOTADO,
  MENSAJE_SIN_AGENTE,
  MENSAJE_SIN_RESPUESTA,
} from './mensajes.js';

/** Prefijo del JID sintético del banco de pruebas del Home (ver conversation.controller.ts). */
const WEB_TEST_JID_PREFIX = 'web-test:';

/** JID sintético para separar el historial del banco de pruebas del Home de las conversaciones reales de WhatsApp. */
export function jidDePrueba(userId: string): string {
  return `${WEB_TEST_JID_PREFIX}${userId}`;
}

/**
 * true si `remoteJid` es del banco de pruebas del Home (quien habla es el
 * propio dueño, no un cliente de WhatsApp) — el prefijo sólo lo arma
 * conversation.controller.ts a partir del usuario autenticado, así que un
 * remoteJid real de Baileys nunca puede tomar este valor.
 */
export function esConversacionDePrueba(remoteJid: string): boolean {
  return remoteJid.startsWith(WEB_TEST_JID_PREFIX);
}

/**
 * Fachada del runtime conversacional. La lógica vive en el grafo de LangGraph
 * (graph/): acá sólo se resuelve a qué agente y a qué hilo pertenece el
 * mensaje entrante, se invoca el grafo y se devuelve el texto para WhatsApp.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GRAFO_CONVERSACION) private readonly grafo: GrafoConversacion,
  ) {}

  async handleIncoming(ownerUserId: string, remoteJid: string, texto: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({ where: { userId: ownerUserId } });
    if (!agent) {
      return MENSAJE_SIN_AGENTE;
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { userId_remoteJid: { userId: ownerUserId, remoteJid } },
      create: { userId: ownerUserId, remoteJid },
      update: {},
    });

    const config = {
      // El hilo del checkpointer es la conversación: único por (userId, remoteJid).
      configurable: { thread_id: conversation.id },
      recursionLimit: LIMITE_RECURSION,
    };

    try {
      const resultado = await this.grafo.invoke(
        {
          messages: [...(await this.historialSemilla(conversation.id, config)), new HumanMessage(texto)],
          ownerUserId,
          remoteJid,
          esPropietario: esConversacionDePrueba(remoteJid),
        },
        config,
      );

      const ultimo = resultado.messages.at(-1);
      const contenido = typeof ultimo?.content === 'string' ? ultimo.content.trim() : '';
      return contenido || MENSAJE_SIN_RESPUESTA;
    } catch (error) {
      if (error instanceof GraphRecursionError) {
        this.logger.warn(`El grafo se quedó sin vueltas en la conversación ${conversation.id}`);
        return MENSAJE_LOOP_AGOTADO;
      }
      this.logger.error(`El grafo falló en la conversación ${conversation.id}`, error as Error);
      return MENSAJE_DISCULPA_GENERICO;
    }
  }

  /**
   * Conversaciones que venían del runtime anterior no tienen checkpoint: la
   * primera vez que entran al grafo se siembra su historial desde la tabla
   * `Message`. Después de esa vez el checkpointer ya tiene el hilo y esto
   * devuelve vacío.
   */
  private async historialSemilla(
    conversationId: string,
    config: { configurable: { thread_id: string } },
  ): Promise<BaseMessage[]> {
    const estado = await this.grafo.getState(config);
    if ((estado.values?.messages ?? []).length > 0) return [];

    const filasDesc = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: VENTANA_HISTORIAL,
    });
    return mensajesDesdeFilas(filasDesc.reverse());
  }
}
