/**
 * Grafo del asistente de ventas. Misma forma que el de agenda: un solo nodo
 * llama al modelo (`conversacion`, compartido), y el resto es código.
 *
 *   START -> cargar_contexto -> conversacion --sin tool calls--> verificar_respuesta --ok--> persistir -> END
 *                                    ^  ^             |                    |
 *                                    |  |         (tool calls)             | (precio sin respaldo:
 *                                    |  |             v                    |  vuelve a intentarlo)
 *                                    |  +---------------------------------+
 *                                 catalogo <--ok-- validacion
 *                                    |                |
 *                                    +----------------+ (rechazo: vuelve sin tocar nada)
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { BusquedaService } from '../../comercio/busqueda.service.js';
import type { HistoricoVentasService } from '../../comercio/historico.service.js';
import type { ImagenesService } from '../../comercio/imagenes.service.js';
import type { SugerenciasService } from '../../comercio/sugerencias.service.js';
import type { VentasService } from '../../comercio/ventas.service.js';
import type { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LIMITE_RECURSION } from '../graph/graph.factory.js';
import { crearNodoConversacion } from '../graph/nodes/conversacion.node.js';
import { crearNodoPersistir } from '../graph/nodes/persistir.node.js';
import { crearNodoCargarContextoVentas } from './nodes/cargar-contexto-ventas.node.js';
import { crearNodoCatalogo } from './nodes/catalogo.node.js';
import { crearNodoValidacionVentas } from './nodes/validacion-ventas.node.js';
import { crearNodoVerificarRespuesta } from './nodes/verificar-respuesta.node.js';
import { EstadoVentas, type EstadoVentasValue } from './state.js';
import { herramientasDeVentas } from './ventas-tools.js';

export type DepsGrafoVentas = {
  prisma: PrismaService;
  busqueda: Pick<BusquedaService, 'buscar'>;
  sugerencias: Pick<SugerenciasService, 'verCatalogo'>;
  ventas: Pick<VentasService, 'crearPedido' | 'pedidosDeConversacion' | 'cancelarUltimoPendiente'>;
  notificaciones: Pick<NotificacionesService, 'avisar' | 'consultaRecienteDe'>;
  historico: Pick<HistoricoVentasService, 'listar' | 'resumen'>;
  imagenes: Pick<ImagenesService, 'estadoDeFoto'>;
  openRouter: OpenRouterClient;
  llm: BaseChatModel;
  checkpointer?: BaseCheckpointSaver;
  /** Hasta cuánto para atrás ve el modelo el historial de un chat (HISTORIAL_IA_VENTANA). Por defecto, 14 días. */
  ventanaHistorialMs?: number;
};

/**
 * Tope de supersteps del grafo de ventas: el de la agenda más lo que suma
 * `verificar_respuesta` (pasar por él al final, y una vuelta de corrección
 * cuando rechaza un precio).
 */
export const LIMITE_RECURSION_VENTAS = LIMITE_RECURSION + 4;

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
    .addNode('verificar_respuesta', crearNodoVerificarRespuesta())
    .addNode('persistir', crearNodoPersistir(deps))
    .addEdge(START, 'cargar_contexto')
    .addEdge('cargar_contexto', 'conversacion')
    .addConditionalEdges(
      'conversacion',
      (state) => (hayToolCalls(state) ? 'validacion' : 'verificar_respuesta'),
      ['validacion', 'verificar_respuesta'],
    )
    .addConditionalEdges(
      'verificar_respuesta',
      // Descartó la respuesta: pidió una corrección y el último mensaje ya no es del asistente.
      (state) => (state.correccion && state.messages.at(-1)?.getType() !== 'ai' ? 'conversacion' : 'persistir'),
      ['persistir', 'conversacion'],
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
