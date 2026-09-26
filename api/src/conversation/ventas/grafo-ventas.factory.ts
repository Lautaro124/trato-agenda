/**
 * Grafo del asistente de ventas. Misma forma que el de agenda: un solo nodo
 * llama al modelo (`conversacion`, compartido), y el resto es código.
 *
 *   START -> cargar_contexto -> conversacion --sin tool calls--> persistir -> END
 *                                    ^                |
 *                                    |            (tool calls)
 *                                    |                v
 *                                 catalogo <--ok-- validacion
 *                                    |                |
 *                                    +----------------+ (rechazo: vuelve sin tocar nada)
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { BusquedaService } from '../../comercio/busqueda.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { crearNodoConversacion } from '../graph/nodes/conversacion.node.js';
import { crearNodoPersistir } from '../graph/nodes/persistir.node.js';
import { crearNodoCargarContextoVentas } from './nodes/cargar-contexto-ventas.node.js';
import { crearNodoCatalogo } from './nodes/catalogo.node.js';
import { crearNodoValidacionVentas } from './nodes/validacion-ventas.node.js';
import { EstadoVentas, type EstadoVentasValue } from './state.js';
import { herramientasDeVentas } from './ventas-tools.js';

export type DepsGrafoVentas = {
  prisma: PrismaService;
  busqueda: Pick<BusquedaService, 'buscar'>;
  openRouter: OpenRouterClient;
  llm: BaseChatModel;
  checkpointer?: BaseCheckpointSaver;
};

function hayToolCalls(state: EstadoVentasValue): boolean {
  const ultimo = state.messages.at(-1);
  if (!ultimo || ultimo.getType() !== 'ai') return false;
  return ((ultimo as { tool_calls?: unknown[] }).tool_calls ?? []).length > 0;
}

export function construirGrafoVentas(deps: DepsGrafoVentas) {
  return new StateGraph(EstadoVentas)
    .addNode('cargar_contexto', crearNodoCargarContextoVentas(deps))
    .addNode('conversacion', crearNodoConversacion({ llm: deps.llm, herramientas: herramientasDeVentas }))
    .addNode('validacion', crearNodoValidacionVentas())
    .addNode('catalogo', crearNodoCatalogo(deps))
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
      (state) => (state.pendientes.length > 0 ? 'catalogo' : 'conversacion'),
      ['catalogo', 'conversacion'],
    )
    .addEdge('catalogo', 'conversacion')
    .addEdge('persistir', END)
    .compile({ checkpointer: deps.checkpointer });
}

export type GrafoVentas = ReturnType<typeof construirGrafoVentas>;
