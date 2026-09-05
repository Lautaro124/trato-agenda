/**
 * Puente entre la tabla `Message` (el historial de siempre, en shape
 * compatible OpenAI) y los mensajes de LangChain. Sólo se usa la primera vez
 * que una conversación entra al grafo: de ahí en adelante el historial vive en
 * el checkpointer y esto no vuelve a correr.
 */
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { Message } from '../../generated/prisma/client.js';

/** Cuántos mensajes previos se rescatan al sembrar un hilo sin checkpoint. */
export const VENTANA_HISTORIAL = 20;

type ToolCallGuardada = { id: string; function?: { name?: string; arguments?: string } };
type MensajeGuardado = { content: string | null; tool_calls?: ToolCallGuardada[]; tool_call_id?: string };

function parsearArgumentos(crudo: string | undefined): Record<string, unknown> {
  if (!crudo) return {};
  try {
    return JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function aMensaje(fila: Pick<Message, 'role' | 'content'>): BaseMessage | null {
  const guardado = fila.content as unknown as MensajeGuardado;
  switch (fila.role) {
    case 'user':
      return new HumanMessage(guardado.content ?? '');
    case 'assistant':
      return new AIMessage({
        content: guardado.content ?? '',
        tool_calls: (guardado.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function?.name ?? '',
          args: parsearArgumentos(call.function?.arguments),
        })),
      });
    case 'tool':
      return new ToolMessage({
        content: guardado.content ?? '',
        tool_call_id: guardado.tool_call_id ?? '',
      });
    default:
      return null;
  }
}

/**
 * Convierte las filas (de más vieja a más nueva) en mensajes de LangChain,
 * descartando los pares tool_call/resultado que quedaron cortados por la
 * ventana: un assistant con tool_calls sin su ToolMessage (o al revés) hace
 * que la API del modelo rechace el pedido entero.
 */
export function mensajesDesdeFilas(filas: Pick<Message, 'role' | 'content'>[]): BaseMessage[] {
  const mensajes = filas.map(aMensaje).filter((mensaje): mensaje is BaseMessage => mensaje !== null);

  const respondidos = new Set(
    mensajes
      .filter((mensaje) => mensaje.getType() === 'tool')
      .map((mensaje) => (mensaje as ToolMessage).tool_call_id),
  );
  const pedidos = new Set(
    mensajes
      .filter((mensaje) => mensaje.getType() === 'ai')
      .flatMap((mensaje) => ((mensaje as AIMessage).tool_calls ?? []).map((call) => call.id ?? '')),
  );

  return mensajes.filter((mensaje) => {
    if (mensaje.getType() === 'tool') {
      return pedidos.has((mensaje as ToolMessage).tool_call_id);
    }
    const llamadas = mensaje.getType() === 'ai' ? ((mensaje as AIMessage).tool_calls ?? []) : [];
    return llamadas.every((call) => respondidos.has(call.id ?? ''));
  });
}
