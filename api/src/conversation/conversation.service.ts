import { enAtencionHumana, MENSAJE_ATENCION_HUMANA_PRUEBA } from '../comercio/pedido-a-medida.rules.js';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tipoAsistenteDe } from '../agents/agent-catalog.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VueltaCancelada, type Cancelacion } from './cancelacion.js';
import {
  GRAFO_CONVERSACION,
  GRAFO_VENTAS,
  type GrafoConversacion,
  type GrafoVentas,
} from './conversation.providers.js';
import { LIMITE_RECURSION } from './graph/graph.factory.js';
import { VENTANA_HISTORIAL, mensajesDesdeFilas } from './graph/historial.js';
import { LIMITE_RECURSION_VENTAS } from './ventas/grafo-ventas.factory.js';
import { imagenesDeLaVuelta, type ImagenAEnviar } from './ventas/imagenes-de-la-vuelta.js';
import {
  MENSAJE_DISCULPA_GENERICO,
  MENSAJE_LOOP_AGOTADO,
  MENSAJE_SIN_AGENTE,
  MENSAJE_SIN_RESPUESTA,
} from './mensajes.js';

/** Vueltas descartadas que se recuerdan a la vez (una por conversación). */
const MAX_VUELTAS_DESCARTADAS = 1000;

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
 * Lo que la fachada usa de cualquiera de los dos grafos. Los dos comparten la
 * entrada (mensajes + dueño + remitente) y la salida (mensajes).
 */
type ConfigDeHilo = { configurable: { thread_id: string; checkpoint_id?: string } };

type GrafoInvocable = {
  invoke: (
    entrada: {
      messages: BaseMessage[];
      ownerUserId: string;
      remoteJid: string;
      esPropietario: boolean;
      cancelacion?: Cancelacion;
    },
    config: ConfigDeHilo & { recursionLimit: number; signal?: AbortSignal },
  ) => Promise<{ messages: BaseMessage[] }>;
  getState: (config: ConfigDeHilo) => Promise<{
    values?: { messages?: BaseMessage[] };
    config?: { configurable?: { checkpoint_id?: string } };
  }>;
  checkpointer?: { deleteThread: (threadId: string) => Promise<void> } | boolean;
};

/** Opciones de una vuelta que llega por WhatsApp. */
export type OpcionesDeVuelta = {
  /** Si se cancela antes de comprometerse, `responder` tira VueltaCancelada y la vuelta no cuenta. */
  cancelacion?: Cancelacion;
};

/** Lo que se le contesta al cliente: el texto y, del asistente de ventas, las fotos a mandar antes. */
export type RespuestaConversacion = {
  texto: string;
  imagenes: ImagenAEnviar[];
  /** El chat lo atiende una persona (LAU-27): el asistente no corrió y no hay que mandar nada. */
  enAtencionHumana?: boolean;
};

/**
 * Fachada del runtime conversacional. La lógica vive en los grafos de
 * LangGraph (graph/ para la agenda, ventas/ para el asistente de ventas): acá
 * sólo se resuelve a qué agente y a qué hilo pertenece el mensaje entrante,
 * qué grafo lo atiende (`Agent.tipoAsistente`), se lo invoca y se devuelve el
 * texto para WhatsApp.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  /**
   * Conversaciones con una vuelta descartada (cancelacion.ts): el checkpoint
   * de antes de esa vuelta, o null si el hilo estaba vacío. La próxima vuelta
   * arranca desde ahí, así lo que quedó a medias (el mensaje del cliente, una
   * búsqueda) no se suma dos veces cuando se rehace con todo junto. En
   * memoria, como las ráfagas: sólo sirve con una réplica.
   */
  private readonly vueltasDescartadas = new Map<string, string | null>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GRAFO_CONVERSACION) private readonly grafoAgenda: GrafoConversacion,
    @Inject(GRAFO_VENTAS) private readonly grafoVentas: GrafoVentas,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Sólo el texto de la respuesta: para quien no manda fotos (los evals). */
  async handleIncoming(ownerUserId: string, remoteJid: string, texto: string): Promise<string> {
    return (await this.responder(ownerUserId, remoteJid, texto)).texto;
  }

  /**
   * La respuesta entera: el texto y las fotos de productos que el asistente
   * de ventas decidió mandar en esta vuelta (sólo id y nombre; los bytes los
   * busca quien las envía).
   */
  async responder(
    ownerUserId: string,
    remoteJid: string,
    texto: string,
    opciones: OpcionesDeVuelta = {},
  ): Promise<RespuestaConversacion> {
    const soloTexto = (mensaje: string): RespuestaConversacion => ({ texto: mensaje, imagenes: [] });
    const agent = await this.prisma.agent.findUnique({ where: { userId: ownerUserId } });
    if (!agent) {
      return soloTexto(MENSAJE_SIN_AGENTE);
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { userId_remoteJid: { userId: ownerUserId, remoteJid } },
      create: { userId: ownerUserId, remoteJid },
      update: {},
    });

    const esVentas = tipoAsistenteDe(agent) === 'ventas';
    if (esVentas && (await this.enAtencionHumana(conversation.id))) {
      // La ráfaga ya estaba esperando cuando el chat pasó a una persona: se
      // guarda lo que escribió el cliente y el asistente no contesta.
      if (esConversacionDePrueba(remoteJid)) return soloTexto(MENSAJE_ATENCION_HUMANA_PRUEBA);
      await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'user', content: { content: texto, enAtencionHumana: true } },
      });
      return { texto: '', imagenes: [], enAtencionHumana: true };
    }
    const grafo = (esVentas ? this.grafoVentas : this.grafoAgenda) as unknown as GrafoInvocable;
    const desde = await this.retomarDescartada(grafo, conversation.id);
    const config = {
      // El hilo del checkpointer es la conversación: único por (userId, remoteJid).
      configurable: { thread_id: conversation.id, ...(desde ? { checkpoint_id: desde } : {}) },
      recursionLimit: esVentas ? LIMITE_RECURSION_VENTAS : LIMITE_RECURSION,
      ...(opciones.cancelacion ? { signal: opciones.cancelacion.signal } : {}),
    };

    const previo = await grafo.getState(config);
    try {
      const resultado = await grafo.invoke(
        {
          messages: [...(await this.historialSemilla(previo, conversation.id)), new HumanMessage(texto)],
          ownerUserId,
          remoteJid,
          esPropietario: esConversacionDePrueba(remoteJid),
          ...(opciones.cancelacion ? { cancelacion: opciones.cancelacion } : {}),
        },
        config,
      );

      const ultimo = resultado.messages.at(-1);
      const contenido = typeof ultimo?.content === 'string' ? ultimo.content.trim() : '';
      return {
        texto: contenido || MENSAJE_SIN_RESPUESTA,
        imagenes: esVentas ? imagenesDeLaVuelta(resultado.messages) : [],
      };
    } catch (error) {
      if (opciones.cancelacion?.cancelada || error instanceof VueltaCancelada) {
        this.vueltasDescartadas.delete(conversation.id);
        this.vueltasDescartadas.set(conversation.id, previo.config?.configurable?.checkpoint_id ?? null);
        // Con tope: si una nunca se reintenta (sesión cerrada), no se acumulan para siempre.
        if (this.vueltasDescartadas.size > MAX_VUELTAS_DESCARTADAS) {
          this.vueltasDescartadas.delete(this.vueltasDescartadas.keys().next().value as string);
        }
        throw new VueltaCancelada();
      }
      if (error instanceof GraphRecursionError) {
        this.logger.warn(`El grafo se quedó sin vueltas en la conversación ${conversation.id}`);
        return soloTexto(MENSAJE_LOOP_AGOTADO);
      }
      this.logger.error(`El grafo falló en la conversación ${conversation.id}`, error as Error);
      return soloTexto(MENSAJE_DISCULPA_GENERICO);
    }
  }

  /** ¿Algún pedido abierto de esta conversación lo atiende una persona? */
  private async enAtencionHumana(conversationId: string): Promise<boolean> {
    const venta = await this.prisma.venta.findFirst({
      where: { conversationId, atencion: 'humana' },
      select: { atencion: true, estado: true },
      orderBy: { derivadaAt: 'desc' },
    });
    return venta !== null && enAtencionHumana(venta);
  }

  /**
   * Si la vuelta anterior de esta conversación se descartó, desde qué
   * checkpoint seguir. Con el hilo vacío antes de esa vuelta no hay
   * checkpoint al que volver: se borra lo que dejó y se siembra de nuevo
   * desde `Message`, donde la vuelta descartada nunca llegó a escribir.
   */
  private async retomarDescartada(grafo: GrafoInvocable, conversationId: string): Promise<string | undefined> {
    if (!this.vueltasDescartadas.has(conversationId)) return undefined;
    const desde = this.vueltasDescartadas.get(conversationId);
    this.vueltasDescartadas.delete(conversationId);
    if (desde) return desde;
    if (typeof grafo.checkpointer === 'object') await grafo.checkpointer.deleteThread(conversationId);
    return undefined;
  }

  /**
   * Conversaciones que venían del runtime anterior no tienen checkpoint: la
   * primera vez que entran al grafo se siembra su historial desde la tabla
   * `Message`, sólo con lo que cae dentro de la ventana que ve el modelo.
   * Después de esa vez el checkpointer ya tiene el hilo y esto devuelve vacío.
   */
  private async historialSemilla(
    estado: { values?: { messages?: BaseMessage[] } },
    conversationId: string,
  ): Promise<BaseMessage[]> {
    if ((estado.values?.messages ?? []).length > 0) return [];

    const desde = new Date(Date.now() - this.config.get('HISTORIAL_IA_VENTANA_MS', { infer: true }));
    const filasDesc = await this.prisma.message.findMany({
      where: { conversationId, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: VENTANA_HISTORIAL,
    });
    return mensajesDesdeFilas(filasDesc.reverse());
  }
}
