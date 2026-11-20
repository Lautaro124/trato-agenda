/**
 * Último nodo: espeja a la tabla `Message` lo que pasó en esta vuelta. El
 * estado del grafo ya vive en el checkpointer, pero `Message` sigue siendo el
 * historial legible que consume el resto de la app, y se guarda en el mismo
 * shape de siempre (compatible OpenAI) para no romper nada que ya lo lea.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { resumenDeError, type OpenRouterClient } from '../../../agents/openrouter.client.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { estadoParaAnalisis, leerAnalisisJev, preguntasDeAnalisis } from '../../../chats/analisis-jev.rules.js';
import {
  analisisGuardado,
  armarPedidoDeAnalisis,
  armarPedidoDeTextos,
  conJev,
  conTextos,
  LARGO_MAX_RESUMEN,
  leerAnalisis,
  leerTextos,
  type AnalisisVenta,
} from '../../../chats/analisis.rules.js';
import type { DecisionesClient } from '../../../comercio/decisiones.client.js';
import { aMensajesPublicos } from '../../../comercio/ventas.types.js';
import { mensajesParaClasificar, type MensajeAClasificar } from '../../../performance/preguntas.rules.js';
import { esFotoDePregunta, imagenesDeLaVuelta, type ImagenAEnviar } from '../../ventas/imagenes-de-la-vuelta.js';
import type { EstadoComun } from '../state.js';

export type DepsPersistir = {
  prisma: PrismaService;
  openRouter: OpenRouterClient;
  /**
   * Cuentas de ventas: la misma llamada que resume también analiza la venta
   * (probabilidad, sentimiento, próximo paso) para el panel del dueño.
   */
  analizarVenta?: boolean;
  /**
   * Jev: con `analizarVenta`, estima probabilidad, ánimo y señales en cada
   * mensaje del cliente, y la llamada del resumen sólo agrega los textos. Sin
   * él (o sin OPENROUTER_API_KEY), esa llamada estima todo.
   */
  decisiones?: Pick<DecisionesClient, 'configurado'> & Partial<Pick<DecisionesClient, 'decidir'>>;
};

/** Mensajes recientes que lee el análisis de la venta. */
const MENSAJES_PARA_ANALIZAR = 20;

/**
 * Cada cuántos mensajes guardados se recalcula el resumen del cliente. Es una
 * segunda llamada al modelo, así que no se hace en cada respuesta.
 */
export const CADA_CUANTOS_MENSAJES_RESUMIR = 6;

type FilaMensaje = { role: 'user' | 'assistant' | 'tool'; content: Prisma.InputJsonValue };

function textoDe(mensaje: BaseMessage): string {
  return typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
}

/**
 * Marca de un mensaje del cliente que ya está en `Message` (lo escribió
 * mientras atendía una persona, LAU-81): la vuelta lo contesta pero no lo
 * guarda otra vez.
 */
export const CLAVE_YA_GUARDADO = 'yaGuardado';

/** Traduce un mensaje de LangChain al JSON que ya guardaba el runtime anterior. */
function aFila(mensaje: BaseMessage): FilaMensaje | null {
  switch (mensaje.getType()) {
    case 'human':
      if ((mensaje.response_metadata as Record<string, unknown> | undefined)?.[CLAVE_YA_GUARDADO] === true) return null;
      return { role: 'user', content: { content: textoDe(mensaje) } };
    case 'ai': {
      const toolCalls = (mensaje as { tool_calls?: { id?: string; name: string; args: unknown }[] }).tool_calls ?? [];
      return {
        role: 'assistant',
        content: {
          content: textoDe(mensaje),
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((call, indice) => ({
                  id: call.id ?? `call-${indice}`,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
                })),
              }
            : {}),
        },
      };
    }
    case 'tool':
      return {
        role: 'tool',
        content: {
          content: textoDe(mensaje),
          tool_call_id: (mensaje as { tool_call_id?: string }).tool_call_id ?? '',
        },
      };
    default:
      return null;
  }
}

/** Una foto mandada, como se guarda en `Message.content.imagenes`: sólo ids y textos, nunca bytes. */
function aImagenGuardada(imagen: ImagenAEnviar): Prisma.InputJsonObject {
  const pie = imagen.leyenda ?? imagen.nombre;
  if (esFotoDePregunta(imagen)) return { imagenPreguntaId: imagen.imagenPreguntaId, leyenda: pie };
  return { productoId: imagen.productoId, ...(imagen.imagenId ? { imagenId: imagen.imagenId } : {}), leyenda: pie };
}

export function crearNodoPersistir(deps: DepsPersistir) {
  const logger = new Logger('PersistirNode');

  /**
   * Actualiza el resumen persistido del cliente para que el agente lo
   * "recuerde" más allá de la ventana de mensajes. Nunca debe romper la
   * respuesta al cliente: cualquier falla acá sólo se loguea.
   */
  async function actualizarResumen(
    conversationId: string,
    resumenPrevio: string | null,
    mensajeCliente: string,
    respuestaAgente: string,
  ): Promise<void> {
    try {
      const resultado = await deps.openRouter.chat({
        messages: [
          {
            role: 'system',
            content:
              'Mantenés un resumen breve (1-2 oraciones) de un cliente para un negocio, a partir de su ' +
              'resumen previo y el último intercambio. Respondé únicamente el texto del resumen actualizado, ' +
              'sin JSON ni markdown.',
          },
          {
            role: 'user',
            content:
              `Resumen previo (puede estar vacío): "${resumenPrevio ?? ''}"\n` +
              `Último mensaje del cliente: "${mensajeCliente}"\n` +
              `Última respuesta del agente: "${respuestaAgente}"`,
          },
        ],
        // Resumir dos líneas es mecánico: pensar acá sólo agrega latencia y costo.
        reasoning: { enabled: false },
      });

      const resumen = resultado.content?.trim();
      if (!resumen) return;

      await deps.prisma.conversation.update({
        where: { id: conversationId },
        data: { resumen: resumen.slice(0, 500) },
      });
    } catch (error) {
      logger.error(
        `No se pudo actualizar el resumen de la conversación ${conversationId}: ${resumenDeError(error)}`,
      );
    }
  }

  /**
   * En ventas, el resumen y el análisis de la venta salen de una sola llamada
   * que lee los últimos mensajes. Lo que vuelve se valida en
   * analisis.rules.ts; si no es un JSON legible pero trae texto, se guarda
   * como resumen, como antes. Nunca rompe la respuesta al cliente.
   */
  /** Los últimos mensajes de texto del chat, saneados (sin emails, links ni números largos). */
  async function mensajesRecientes(conversationId: string): Promise<MensajeAClasificar[]> {
    const filas = await deps.prisma.message.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: MENSAJES_PARA_ANALIZAR,
      select: { role: true, content: true, createdAt: true },
    });
    return mensajesParaClasificar(aMensajesPublicos(filas.reverse()));
  }

  async function analisisActual(conversationId: string): Promise<AnalisisVenta | null> {
    const fila = await deps.prisma.conversation.findUnique({ where: { id: conversationId }, select: { analisis: true } });
    return analisisGuardado(fila?.analisis ?? null);
  }

  async function guardarAnalisis(conversationId: string, analisis: AnalisisVenta, resumen: string | null = null): Promise<void> {
    await deps.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        analisis: analisis as unknown as Prisma.InputJsonObject,
        ...(resumen ? { resumen: resumen.slice(0, LARGO_MAX_RESUMEN) } : {}),
      },
    });
  }

  /**
   * Jev, en cada mensaje del cliente: probabilidad, ánimo, tema y señales.
   * Conserva los textos que haya dejado el modelo de chat. Nunca rompe la
   * respuesta al cliente: si falla, queda el análisis anterior.
   */
  async function analizarConJev(conversationId: string, nombreCliente: string | null): Promise<void> {
    if (!deps.decisiones?.decidir) return;
    try {
      const estado = estadoParaAnalisis(await mensajesRecientes(conversationId), nombreCliente);
      if (!estado) return;
      const jev = leerAnalisisJev(await deps.decisiones.decidir(estado, preguntasDeAnalisis()));
      if (!jev) return;
      await guardarAnalisis(conversationId, conJev(await analisisActual(conversationId), jev, new Date()));
    } catch (error) {
      logger.error(`Jev no analizó la conversación ${conversationId}: ${resumenDeError(error)}`);
    }
  }

  /**
   * Con un análisis de Jev ya guardado, el modelo de chat sólo agrega el
   * resumen, el presupuesto, el próximo paso y el mensaje sugerido. Devuelve
   * false si no había análisis: entonces lo estima todo el modelo de chat.
   */
  async function completarTextos(conversationId: string, resumenPrevio: string | null): Promise<boolean> {
    const analisis = await analisisActual(conversationId);
    if (!analisis) return false;
    try {
      const mensajes = await mensajesRecientes(conversationId);
      if (!mensajes.some((mensaje) => mensaje.de === 'cliente')) return true;
      const resultado = await deps.openRouter.chat({
        messages: armarPedidoDeTextos(resumenPrevio, mensajes, analisis),
        reasoning: { enabled: false },
        maxTokens: 600,
      });
      const textos = leerTextos(resultado.content);
      if (!textos) return true;
      await guardarAnalisis(conversationId, conTextos(analisis, textos, new Date()), textos.resumen);
    } catch (error) {
      logger.error(`No se pudieron completar los textos de la conversación ${conversationId}: ${resumenDeError(error)}`);
    }
    return true;
  }

  async function actualizarResumenYAnalisis(conversationId: string, resumenPrevio: string | null): Promise<void> {
    try {
      const mensajes = await mensajesRecientes(conversationId);
      if (!mensajes.some((mensaje) => mensaje.de === 'cliente')) return;

      const resultado = await deps.openRouter.chat({
        messages: armarPedidoDeAnalisis(resumenPrevio, mensajes),
        reasoning: { enabled: false },
        maxTokens: 800,
      });
      const leido = leerAnalisis(resultado.content, new Date());
      const textoPlano = !leido && resultado.content?.trim() && !resultado.content.trim().startsWith('{') ? resultado.content.trim() : null;
      const resumen = leido?.resumen ?? textoPlano;
      const analisis = leido?.analisis ?? null;
      if (!resumen && !analisis) return;

      await deps.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ...(resumen ? { resumen: resumen.slice(0, LARGO_MAX_RESUMEN) } : {}),
          ...(analisis ? { analisis: analisis as unknown as Prisma.InputJsonObject } : {}),
        },
      });
    } catch (error) {
      logger.error(`No se pudo analizar la conversación ${conversationId}: ${resumenDeError(error)}`);
    }
  }

  return async (state: EstadoComun): Promise<Record<string, never>> => {
    // De acá en adelante la respuesta queda guardada: ya no se descarta aunque el cliente siga escribiendo.
    state.cancelacion?.comprometer();
    const { conversation } = state.contexto;
    const nuevos = state.messages.slice(state.indiceDesde);
    // Las fotos que salieron en esta vuelta (sólo ids, nombre y pie) van con la respuesta final: así el chat de
    // Trato las muestra como las vio el cliente. Las herramientas no se muestran, la respuesta sí.
    const imagenes = imagenesDeLaVuelta(nuevos);
    const final = nuevos.findLast((mensaje) => mensaje.getType() === 'ai');

    for (const mensaje of nuevos) {
      const fila = aFila(mensaje);
      if (!fila) continue;
      if (mensaje === final && imagenes.length > 0) {
        fila.content = { ...(fila.content as Prisma.InputJsonObject), imagenes: imagenes.map(aImagenGuardada) };
      }
      await deps.prisma.message.create({ data: { conversationId: conversation.id, ...fila } });
    }

    if (!state.esPropietario) await recordar(conversation, nuevos);
    return {};
  };

  /**
   * Lo que el asistente "recuerda" del cliente: en ventas, el análisis de Jev
   * en cada mensaje; cada pocos mensajes, el resumen (y en ventas, los textos
   * del análisis).
   */
  async function recordar(
    conversation: EstadoComun['contexto']['conversation'],
    nuevos: BaseMessage[],
  ): Promise<void> {
    const conJevActivo = Boolean(deps.analizarVenta && deps.decisiones?.configurado && deps.decisiones.decidir);
    if (conJevActivo && nuevos.some((mensaje) => mensaje.getType() === 'human')) {
      await analizarConJev(conversation.id, conversation.nombreCliente);
    }

    const total = await deps.prisma.message.count({ where: { conversationId: conversation.id } });
    if (total % CADA_CUANTOS_MENSAJES_RESUMIR !== 0) return;

    if (deps.analizarVenta) {
      if (!conJevActivo || !(await completarTextos(conversation.id, conversation.resumen))) {
        await actualizarResumenYAnalisis(conversation.id, conversation.resumen);
      }
      return;
    }

    const primerHumano = nuevos.find((mensaje) => mensaje.getType() === 'human');
    const ultimoAgente = nuevos.filter((mensaje) => mensaje.getType() === 'ai').at(-1);
    await actualizarResumen(
      conversation.id,
      conversation.resumen,
      primerHumano ? textoDe(primerHumano) : '',
      ultimoAgente ? textoDe(ultimoAgente) : '',
    );
  }
}
