/**
 * Puente entre la tabla `Message` (el historial de siempre, en shape
 * compatible OpenAI) y los mensajes de LangChain. Sólo se usa la primera vez
 * que una conversación entra al grafo: de ahí en adelante el historial vive en
 * el checkpointer y esto no vuelve a correr.
 */
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { Message } from '../../generated/prisma/client.js';
import { conMarcaDeLlegada, sinParesCortados } from './ventana-historial.js';

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
 * ventana. Los mensajes del cliente llevan la hora en que se guardaron, que es
 * con la que después se decide si siguen dentro de la ventana del modelo.
 */
export function mensajesDesdeFilas(filas: Pick<Message, 'role' | 'content' | 'createdAt'>[]): BaseMessage[] {
  const mensajes = filas.flatMap((fila) => {
    const mensaje = aMensaje(fila);
    if (!mensaje) return [];
    return mensaje.getType() === 'human' ? [conMarcaDeLlegada(mensaje, fila.createdAt)] : [mensaje];
  });
  return sinParesCortados(mensajes);
}
