/**
 * Único nodo del grafo de ventas que toca el catálogo: ejecuta lo que aprobó
 * la validación y devuelve un ToolMessage por cada llamada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { BusquedaService } from '../../../comercio/busqueda.service.js';
import type { HistoricoVentasService } from '../../../comercio/historico.service.js';
import { RangoInvalidoError } from '../../../comercio/historico.rules.js';
import type { ItemPedido, MedioDePago } from '../../../comercio/ventas.rules.js';
import { telefonoDeJid } from '../../../comercio/ventas.rules.js';
import { PedidoRechazadoError, type VentasService } from '../../../comercio/ventas.service.js';
import type { SugerenciasService } from '../../../comercio/sugerencias.service.js';
import { avisoConsultaDerivada } from '../../../notificaciones/avisos.js';
import type { NotificacionesService } from '../../../notificaciones/notificaciones.service.js';
import type { OperacionPendiente } from '../../graph/state.js';
import {
  formatearCatalogo,
  formatearListadoVentas,
  formatearPedidoCreado,
  formatearPedidos,
  formatearResultados,
  formatearResumenVentas,
  formatearStockDueno,
} from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

export type DepsCatalogo = {
  busqueda: Pick<BusquedaService, 'buscar'>;
  sugerencias: Pick<SugerenciasService, 'verCatalogo'>;
  ventas: Pick<VentasService, 'crearPedido' | 'pedidosDeConversacion' | 'cancelarUltimoPendiente'>;
  notificaciones: Pick<NotificacionesService, 'avisar' | 'consultaRecienteDe'>;
  historico: Pick<HistoricoVentasService, 'listar' | 'resumen'>;
};

/** Sólo lo que escribió el cliente, en texto: es lo único que se le pasa a Jev. */
export function mensajesDelCliente(state: Pick<EstadoVentasValue, 'messages'>): string[] {
  return state.messages
    .filter((mensaje) => mensaje.getType() === 'human' && typeof mensaje.content === 'string')
    .map((mensaje) => mensaje.content as string);
}

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
      case 'ver_catalogo': {
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        return formatearCatalogo(
          await deps.sugerencias.verCatalogo(state.ownerUserId, mensajesDelCliente(state), categoria),
        );
      }
      case 'consultar_stock': {
        const consulta = String(args.consulta);
        return formatearStockDueno(consulta, await deps.busqueda.buscar(state.ownerUserId, consulta));
      }
      case 'crear_pedido': {
        const { agent, conversation, mpConectado } = state.contexto;
        const medioPago: MedioDePago =
          args.medioPago === 'manual' || args.medioPago === 'mercadopago'
            ? args.medioPago
            : mpConectado
              ? 'mercadopago'
              : 'manual';
        try {
          const venta = await deps.ventas.crearPedido({
            userId: state.ownerUserId,
            conversationId: conversation.id,
            remoteJid: state.remoteJid,
            nombreCliente: String(args.nombreCliente),
            items: args.items as ItemPedido[],
            medioPago,
            // El banco de pruebas del Home (quien habla es el dueño): pedido real, fuera del histórico.
            dePrueba: state.esPropietario,
          });
          return formatearPedidoCreado(agent, venta);
        } catch (error) {
          if (error instanceof PedidoRechazadoError) return `No se pudo crear el pedido: ${error.message}`;
          throw error;
        }
      }
      case 'derivar_consulta': {
        const { agent, conversation } = state.contexto;
        const titular = agent.nombreTitular || 'el negocio';
        const decile = `Decile al cliente que ${titular} le va a responder por este chat.`;
        if (await deps.notificaciones.consultaRecienteDe(state.ownerUserId, conversation.id)) {
          return `Ya le avisé a ${titular} hace un rato de una consulta de este cliente: no lo vuelvo a molestar. ${decile}`;
        }
        await deps.notificaciones.avisar(
          state.ownerUserId,
          avisoConsultaDerivada({
            conversationId: conversation.id,
            nombreCliente: conversation.nombreCliente,
            telefonoCliente: telefonoDeJid(state.remoteJid),
            resumen: String(args.resumen),
            dePrueba: state.esPropietario,
          }),
        );
        return `Listo, le avisé a ${titular}. ${decile}`;
      }
      case 'listar_ventas':
      case 'resumen_ventas': {
        const filtros = {
          desde: typeof args.desde === 'string' ? args.desde : undefined,
          hasta: typeof args.hasta === 'string' ? args.hasta : undefined,
        };
        try {
          if (operacion.nombre === 'listar_ventas') {
            const estado = typeof args.estado === 'string' ? (args.estado as never) : undefined;
            return formatearListadoVentas(await deps.historico.listar(state.ownerUserId, { ...filtros, estado }));
          }
          const [resumen, listado] = await Promise.all([
            deps.historico.resumen(state.ownerUserId, filtros),
            deps.historico.listar(state.ownerUserId, filtros),
          ]);
          return formatearResumenVentas(resumen, listado);
        } catch (error) {
          if (error instanceof RangoInvalidoError) return `Fechas inválidas: ${error.message}`;
          throw error;
        }
      }
      case 'consultar_pedido':
        return formatearPedidos(await deps.ventas.pedidosDeConversacion(state.contexto.conversation.id));
      case 'cancelar_pedido': {
        const cancelado = await deps.ventas.cancelarUltimoPendiente(state.contexto.conversation.id);
        return cancelado
          ? `Pedido cancelado y reserva liberada: ${formatearPedidos([cancelado])}`
          : 'Este cliente no tiene pedidos sin pagar para cancelar.';
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
