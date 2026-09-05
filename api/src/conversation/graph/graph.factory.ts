/**
 * Armado del grafo conversacional. Un solo nodo llama al modelo
 * (`conversacion`); los otros cuatro son código: cargan el contexto, validan
 * las reglas de agenda contra el snapshot, ejecutan en Google Calendar y
 * espejan el historial.
 *
 *   START -> cargar_contexto -> conversacion --sin tool calls--> persistir -> END
 *                                    ^                |
 *                                    |            (tool calls)
 *                                    |                v
 *                                 calendar <--ok-- validacion
 *                                    |                |
 *                                    +----------------+ (rechazo: vuelve sin tocar Google)
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { CalendarService } from '../../calendar/calendar.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { crearNodoCalendar } from './nodes/calendar.node.js';
import { crearNodoCargarContexto } from './nodes/cargar-contexto.node.js';
import { crearNodoConversacion } from './nodes/conversacion.node.js';
import { crearNodoPersistir } from './nodes/persistir.node.js';
import { crearNodoValidacion } from './nodes/validacion.node.js';
import { EstadoConversacion, type EstadoConversacionValue } from './state.js';

export type DepsGrafo = {
  prisma: PrismaService;
  calendarService: CalendarService;
  openRouter: OpenRouterClient;
  llm: BaseChatModel;
  checkpointer?: BaseCheckpointSaver;
};

/**
 * Tope de supersteps por mensaje entrante. Reemplaza al viejo `MAX_VUELTAS`:
 * 2 nodos de entrada/salida + 4 ciclos de (conversacion, validacion, calendar).
 */
export const LIMITE_RECURSION = 14;

function hayToolCalls(state: EstadoConversacionValue): boolean {
  const ultimo = state.messages.at(-1);
  if (!ultimo || ultimo.getType() !== 'ai') return false;
  return ((ultimo as { tool_calls?: unknown[] }).tool_calls ?? []).length > 0;
}

export function construirGrafo(deps: DepsGrafo) {
  return new StateGraph(EstadoConversacion)
    .addNode('cargar_contexto', crearNodoCargarContexto(deps))
    .addNode('conversacion', crearNodoConversacion(deps))
    .addNode('validacion', crearNodoValidacion())
    .addNode('calendar', crearNodoCalendar(deps))
    .addNode('persistir', crearNodoPersistir(deps))
    .addEdge(START, 'cargar_contexto')
    .addEdge('cargar_contexto', 'conversacion')
    .addConditionalEdges(
      'conversacion',
      (state) => (hayToolCalls(state) ? 'validacion' : 'persistir'),
      ['validacion', 'persistir'],
    )
    .addConditionalEdges(
      'validacion',
      // Si la validación rechazó todo, no hay nada que ejecutar: vuelve al
      // modelo con los motivos y sin haber tocado Google.
      (state) => (state.pendientes.length > 0 ? 'calendar' : 'conversacion'),
      ['calendar', 'conversacion'],
    )
    .addEdge('calendar', 'conversacion')
    .addEdge('persistir', END)
    .compile({ checkpointer: deps.checkpointer });
}

export type GrafoConversacion = ReturnType<typeof construirGrafo>;
