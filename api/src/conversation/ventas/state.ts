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
  /** Si el comercio conectó Mercado Pago: define el medio de pago por defecto de crear_pedido. */
  mpConectado: boolean;
};

export const EstadoVentas = new StateSchema({
  messages: MessagesValue,
  ownerUserId: z.string(),
  remoteJid: z.string(),
  esPropietario: z.boolean().default(false),
  contexto: new UntrackedValue<ContextoVentas>(undefined, { guard: false }),
  pendientes: new UntrackedValue<OperacionPendiente[]>(undefined, { guard: false }),
  indiceDesde: new UntrackedValue<number>(undefined, { guard: false }),
  /** Primer índice de `messages` que ve el modelo en esta vuelta (ventana-historial.ts). */
  inicioVisible: new UntrackedValue<number>(undefined, { guard: false }),
  /**
   * Lo que `verificar_respuesta` le pide al modelo que corrija (precios que no
   * salen del catálogo). Vacía = la respuesta todavía no se rechazó en esta vuelta.
   */
  correccion: new UntrackedValue<string>(undefined, { guard: false }),
});

export type EstadoVentasValue = typeof EstadoVentas.State;
export type EstadoVentasUpdate = typeof EstadoVentas.Update;
