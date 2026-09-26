/**
 * Estado del grafo de ventas. Mismo criterio que el de agenda (graph/state.ts):
 * todo lo que no es historial es `UntrackedValue`, se recalcula en cada mensaje
 * y no va al checkpoint.
 */
import { MessagesValue, StateSchema, UntrackedValue } from '@langchain/langgraph';
import { z } from 'zod';
import type { Conversation } from '../../generated/prisma/client.js';
import type { AgentConUser, OperacionPendiente } from '../graph/state.js';

/** Lo que `cargar_contexto_ventas` deja listo para el resto del grafo. */
export type ContextoVentas = {
  agent: AgentConUser;
  conversation: Conversation;
  bloqueSistema: string;
};

export const EstadoVentas = new StateSchema({
  messages: MessagesValue,
  ownerUserId: z.string(),
  remoteJid: z.string(),
  esPropietario: z.boolean().default(false),
  contexto: new UntrackedValue<ContextoVentas>(undefined, { guard: false }),
  pendientes: new UntrackedValue<OperacionPendiente[]>(undefined, { guard: false }),
  indiceDesde: new UntrackedValue<number>(undefined, { guard: false }),
});

export type EstadoVentasValue = typeof EstadoVentas.State;
export type EstadoVentasUpdate = typeof EstadoVentas.Update;
