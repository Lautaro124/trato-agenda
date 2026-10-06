/**
 * Validación de las tool calls del asistente de ventas: código puro, sin base
 * ni red. Revisa que la herramienta exista para este agente y que los
 * argumentos cumplan su schema. Lo que rechaza vuelve al modelo como
 * ToolMessage; lo que pasa, lo ejecuta el nodo `catalogo`.
 */
import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { esAccionDeVentas } from '../../../agents/agent-catalog.js';
import { agruparItems, problemaDeForma, type ItemPedido } from '../../../comercio/ventas.rules.js';
import { LARGO_MAX_CONSULTA } from '../../../notificaciones/avisos.js';
import type { EsquemaHerramienta } from '../../conversation-tools.js';
import { llamadasDe, type OperacionPendiente } from '../../graph/state.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import { MAX_BUSQUEDAS_POR_MENSAJE, variantesMostradas } from '../reglas-ventas.js';
import { accionesDeVentas, ESQUEMAS_PROPIETARIO_VENTAS, ESQUEMAS_VENTAS } from '../ventas-tools.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

/** Largo máximo de una consulta al catálogo: lo que pase de eso no es una búsqueda. */
export const MAX_LARGO_CONSULTA = 200;

type Veredicto = { ok: true; operacion: OperacionPendiente } | { ok: false; motivo: string };

/** Lo que la validación necesita saber de la charla, además de la llamada. */
export type HistorialValidacion = {
  /** buscar_productos ya aprobadas en este mensaje del cliente. */
  busquedasEnElMensaje: number;
  /** Ids de variante que aparecieron en búsquedas dentro de la ventana que ve el modelo. */
  variantesVistas: Set<string>;
};

/** Cuenta las búsquedas de esta vuelta y junta las variantes que se le mostraron al modelo. */
export function historialValidacion(state: EstadoVentasValue): HistorialValidacion {
  const textoDe = (mensaje: BaseMessage) =>
    typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
  const resultados = mensajesVisibles(state.messages, state.inicioVisible ?? 0).filter(
    (mensaje) => mensaje.getType() === 'tool',
  );
  return {
    busquedasEnElMensaje: state.messages
      .slice(state.indiceDesde ?? 0)
      .filter((mensaje) => mensaje.getType() === 'tool' && (mensaje as ToolMessage).name === 'buscar_productos').length,
    // Por el contenido y no por el nombre: los ToolMessage sembrados desde la tabla Message no lo traen.
    variantesVistas: variantesMostradas(resultados.map(textoDe)),
  };
}

function esquemaPara(state: EstadoVentasValue, nombre: string): EsquemaHerramienta | undefined {
  if (esAccionDeVentas(nombre) && accionesDeVentas(state.contexto.agent.allowedActions).includes(nombre)) {
    return ESQUEMAS_VENTAS[nombre];
  }
  if (state.esPropietario) return ESQUEMAS_PROPIETARIO_VENTAS[nombre];
  return undefined;
}

export function validarLlamadaVentas(
  state: EstadoVentasValue,
  llamada: OperacionPendiente,
  historial: HistorialValidacion,
): Veredicto {
  const esquema = esquemaPara(state, llamada.nombre);
  if (!esquema) {
    return { ok: false, motivo: `La herramienta ${llamada.nombre} no existe. Usá sólo las que tenés disponibles.` };
  }
  const parseo = esquema.schema.safeParse(llamada.args);
  if (!parseo.success) {
    return {
      ok: false,
      motivo: `Argumentos inválidos para ${llamada.nombre}: ${parseo.error.issues.map((issue) => issue.message).join('; ')}.`,
    };
  }
  const args = parseo.data;

  if (llamada.nombre === 'buscar_productos' || llamada.nombre === 'consultar_stock') {
    const consulta = String(args.consulta ?? '').trim();
    if (!consulta) return { ok: false, motivo: 'La consulta está vacía: decí qué producto buscás.' };
    if (consulta.length > MAX_LARGO_CONSULTA) {
      return { ok: false, motivo: `La consulta es demasiado larga: resumila en menos de ${MAX_LARGO_CONSULTA} caracteres.` };
    }
    if (llamada.nombre === 'buscar_productos' && historial.busquedasEnElMensaje >= MAX_BUSQUEDAS_POR_MENSAJE) {
      return {
        ok: false,
        motivo:
          `Ya buscaste ${MAX_BUSQUEDAS_POR_MENSAJE} veces para este mensaje. Si no apareció lo que pide, no lo ` +
          'tenés: decíselo al cliente sin inventar precio ni stock, y preguntale si busca otra cosa.',
      };
    }
    return { ok: true, operacion: { ...llamada, args: { ...args, consulta } } };
  }

  if (llamada.nombre === 'ver_catalogo') {
    const categoria = typeof args.categoria === 'string' ? args.categoria.trim() : '';
    if (categoria.length > MAX_LARGO_CONSULTA) {
      return { ok: false, motivo: `La categoría es demasiado larga: usá el nombre tal como se la sugeriste.` };
    }
    return { ok: true, operacion: { ...llamada, args: categoria ? { categoria } : {} } };
  }

  if (llamada.nombre === 'listar_ventas' || llamada.nombre === 'resumen_ventas') {
    for (const campo of ['desde', 'hasta'] as const) {
      const valor = args[campo];
      if (valor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) {
        return { ok: false, motivo: `${campo} tiene que ser un día AAAA-MM-DD.` };
      }
    }
    return { ok: true, operacion: { ...llamada, args } };
  }

  if (llamada.nombre === 'derivar_consulta') {
    const resumen = String(args.resumen ?? '').trim();
    if (!resumen) return { ok: false, motivo: 'El resumen de la consulta está vacío.' };
    return { ok: true, operacion: { ...llamada, args: { resumen: resumen.slice(0, LARGO_MAX_CONSULTA) } } };
  }

  if (llamada.nombre === 'crear_pedido') {
    const nombreCliente = String(args.nombreCliente ?? '').trim();
    if (!nombreCliente) {
      return { ok: false, motivo: 'Falta el nombre de la persona que compra: preguntáselo antes de crear el pedido.' };
    }
    const items = (args.items ?? []) as ItemPedido[];
    const problema = problemaDeForma(items);
    if (problema) return { ok: false, motivo: problema };
    // El id tiene que haber salido de una búsqueda de esta charla: uno recordado
    // de antes de la ventana o inventado es un producto que nadie le mostró.
    const noVistas = items.filter((item) => !historial.variantesVistas.has(item.varianteId));
    if (noVistas.length > 0) {
      return {
        ok: false,
        motivo:
          'Hay variantes que no salieron de ninguna búsqueda de esta charla. Buscá cada producto con ' +
          'buscar_productos y usá los ids de variante que te devuelva.',
      };
    }
    return { ok: true, operacion: { ...llamada, args: { ...args, nombreCliente, items: agruparItems(items) } } };
  }

  return { ok: true, operacion: { ...llamada, args } };
}

export function crearNodoValidacionVentas() {
  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const ultimo = state.messages.at(-1);
    const llamadas = llamadasDe(
      ultimo && ultimo.getType() === 'ai' ? (ultimo as { tool_calls?: never[] }).tool_calls : undefined,
    );

    const historial = historialValidacion(state);
    const mensajes: ToolMessage[] = [];
    const pendientes: OperacionPendiente[] = [];
    for (const llamada of llamadas) {
      const veredicto = validarLlamadaVentas(state, llamada, historial);
      if (veredicto.ok) {
        // Varias búsquedas en una misma respuesta también cuentan para el tope.
        if (veredicto.operacion.nombre === 'buscar_productos') historial.busquedasEnElMensaje += 1;
        pendientes.push(veredicto.operacion);
      }
      else mensajes.push(new ToolMessage({ content: veredicto.motivo, tool_call_id: llamada.id, name: llamada.nombre }));
    }
    return { messages: mensajes, pendientes };
  };
}
