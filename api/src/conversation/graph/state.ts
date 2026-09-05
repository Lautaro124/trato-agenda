/**
 * Estado del grafo conversacional. Todo lo que no es historial de mensajes es
 * `UntrackedValue`: se recalcula en cada mensaje entrante y NO va al
 * checkpoint. Además de ahorrar espacio, eso garantiza que el refresh token de
 * Google (que viaja dentro de `contexto.agent.user`) nunca quede serializado
 * en la base del checkpointer.
 */
import type { ToolCall } from '@langchain/core/messages/tool';
import { MessagesValue, StateSchema, UntrackedValue } from '@langchain/langgraph';
import { z } from 'zod';
import type { PeriodoOcupado } from '../../calendar/calendar.service.js';
import type { Agent, Conversation, Turno, User } from '../../generated/prisma/client.js';

export type AgentConUser = Agent & { user: User };

/** Lo que el nodo `cargar_contexto` deja listo para el resto del grafo. */
export type ContextoTurno = {
  agent: AgentConUser;
  conversation: Conversation;
  turnoActivo: Turno | null;
  /** System prompt completo: el generado por el meta-agente + reglas + agenda. */
  bloqueSistema: string;
};

/**
 * Foto de la agenda del dueño tomada UNA sola vez por mensaje entrante. La
 * consultan tanto el nodo de validación como `consultar_disponibilidad`, así
 * que una conversación entera cuesta una única llamada a freeBusy.
 */
export type SnapshotAgenda = {
  desde: Date;
  hasta: Date;
  ocupados: PeriodoOcupado[];
  /** true si Google no respondió: la agenda no se pudo leer y no hay que agendar a ciegas. */
  falla: boolean;
};

/** Una tool call que pasó la validación y le toca ejecutar al nodo `calendar`. */
export type OperacionPendiente = {
  id: string;
  nombre: string;
  args: Record<string, unknown>;
};

export const EstadoConversacion = new StateSchema({
  messages: MessagesValue,
  ownerUserId: z.string(),
  remoteJid: z.string(),
  esPropietario: z.boolean().default(false),
  contexto: new UntrackedValue<ContextoTurno>(undefined, { guard: false }),
  agenda: new UntrackedValue<SnapshotAgenda>(undefined, { guard: false }),
  pendientes: new UntrackedValue<OperacionPendiente[]>(undefined, { guard: false }),
  /**
   * Índice del primer mensaje de esta vuelta dentro de `messages`. El nodo
   * `persistir` espeja a la tabla Message sólo de acá en adelante.
   */
  indiceDesde: new UntrackedValue<number>(undefined, { guard: false }),
});

export type EstadoConversacionValue = typeof EstadoConversacion.State;
export type EstadoConversacionUpdate = typeof EstadoConversacion.Update;

/** Las tool calls de un AIMessage, ya normalizadas (id siempre presente). */
export function llamadasDe(toolCalls: ToolCall[] | undefined): OperacionPendiente[] {
  return (toolCalls ?? []).map((call, indice) => ({
    id: call.id ?? `call-${indice}`,
    nombre: call.name,
    args: (call.args ?? {}) as Record<string, unknown>,
  }));
}
