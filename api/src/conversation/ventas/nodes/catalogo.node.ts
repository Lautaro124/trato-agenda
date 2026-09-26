/**
 * Único nodo del grafo de ventas que toca el catálogo: ejecuta lo que aprobó
 * la validación y devuelve un ToolMessage por cada llamada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { BusquedaService } from '../../../comercio/busqueda.service.js';
import type { OperacionPendiente } from '../../graph/state.js';
import { formatearResultados, formatearStockDueno } from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

export type DepsCatalogo = { busqueda: Pick<BusquedaService, 'buscar'> };

export const MENSAJE_CATALOGO_CAIDO =
  'No pude consultar el catálogo en este momento. Pedile disculpas al cliente y decile que en un rato lo vuelva a intentar.';

export function crearNodoCatalogo(deps: DepsCatalogo) {
  const logger = new Logger('CatalogoNode');

  async function ejecutar(state: EstadoVentasValue, operacion: OperacionPendiente): Promise<string> {
    const { args } = operacion;
    switch (operacion.nombre) {
      case 'buscar_productos': {
        const consulta = String(args.consulta);
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        const productos = await deps.busqueda.buscar(state.ownerUserId, consulta, { categoria });
        return formatearResultados(consulta, productos);
      }
      case 'consultar_stock': {
        const consulta = String(args.consulta);
        return formatearStockDueno(consulta, await deps.busqueda.buscar(state.ownerUserId, consulta));
      }
      default:
        return `La herramienta ${operacion.nombre} no existe.`;
    }
  }

  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const mensajes: ToolMessage[] = [];
    for (const operacion of state.pendientes) {
      let texto: string;
      try {
        texto = await ejecutar(state, operacion);
      } catch (error) {
        logger.error(`Falló ${operacion.nombre} en la conversación ${state.contexto.conversation.id}: ${(error as Error).message}`);
        texto = MENSAJE_CATALOGO_CAIDO;
      }
      mensajes.push(new ToolMessage({ content: texto, tool_call_id: operacion.id, name: operacion.nombre }));
    }
    return { messages: mensajes, pendientes: [] };
  };
}
