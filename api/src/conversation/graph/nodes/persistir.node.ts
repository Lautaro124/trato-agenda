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
import type { EstadoConversacionUpdate, EstadoConversacionValue } from '../state.js';

export type DepsPersistir = {
  prisma: PrismaService;
  openRouter: OpenRouterClient;
};

/**
 * Cada cuántos mensajes guardados se recalcula el resumen del cliente. Es una
 * segunda llamada al modelo, así que no se hace en cada respuesta.
 */
export const CADA_CUANTOS_MENSAJES_RESUMIR = 6;

type FilaMensaje = { role: 'user' | 'assistant' | 'tool'; content: Prisma.InputJsonValue };

function textoDe(mensaje: BaseMessage): string {
  return typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
}

/** Traduce un mensaje de LangChain al JSON que ya guardaba el runtime anterior. */
function aFila(mensaje: BaseMessage): FilaMensaje | null {
  switch (mensaje.getType()) {
    case 'human':
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

  return async (state: EstadoConversacionValue): Promise<EstadoConversacionUpdate> => {
    const { conversation } = state.contexto;
    const nuevos = state.messages.slice(state.indiceDesde);

    for (const mensaje of nuevos) {
      const fila = aFila(mensaje);
      if (!fila) continue;
      await deps.prisma.message.create({ data: { conversationId: conversation.id, ...fila } });
    }

    if (state.esPropietario) return {};

    const total = await deps.prisma.message.count({ where: { conversationId: conversation.id } });
    if (total % CADA_CUANTOS_MENSAJES_RESUMIR !== 0) return {};

    const primerHumano = nuevos.find((mensaje) => mensaje.getType() === 'human');
    const ultimoAgente = nuevos.filter((mensaje) => mensaje.getType() === 'ai').at(-1);
    await actualizarResumen(
      conversation.id,
      conversation.resumen,
      primerHumano ? textoDe(primerHumano) : '',
      ultimoAgente ? textoDe(ultimoAgente) : '',
    );
    return {};
  };
}
