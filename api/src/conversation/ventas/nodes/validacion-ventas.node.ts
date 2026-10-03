/**
 * Validación de las tool calls del asistente de ventas: código puro, sin base
 * ni red. Revisa que la herramienta exista para este agente y que los
 * argumentos cumplan su schema. Lo que rechaza vuelve al modelo como
 * ToolMessage; lo que pasa, lo ejecuta el nodo `catalogo`.
 */
import { ToolMessage } from '@langchain/core/messages';
import { esAccionDeVentas } from '../../../agents/agent-catalog.js';
import { agruparItems, problemaDeForma, type ItemPedido } from '../../../comercio/ventas.rules.js';
import { LARGO_MAX_CONSULTA } from '../../../notificaciones/avisos.js';
import type { EsquemaHerramienta } from '../../conversation-tools.js';
import { llamadasDe, type OperacionPendiente } from '../../graph/state.js';
import { accionesDeVentas, ESQUEMAS_PROPIETARIO_VENTAS, ESQUEMAS_VENTAS } from '../ventas-tools.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

/** Largo máximo de una consulta al catálogo: lo que pase de eso no es una búsqueda. */
export const MAX_LARGO_CONSULTA = 200;

type Veredicto = { ok: true; operacion: OperacionPendiente } | { ok: false; motivo: string };

function esquemaPara(state: EstadoVentasValue, nombre: string): EsquemaHerramienta | undefined {
  if (esAccionDeVentas(nombre) && accionesDeVentas(state.contexto.agent.allowedActions).includes(nombre)) {
    return ESQUEMAS_VENTAS[nombre];
  }
  if (state.esPropietario) return ESQUEMAS_PROPIETARIO_VENTAS[nombre];
  return undefined;
}

export function validarLlamadaVentas(state: EstadoVentasValue, llamada: OperacionPendiente): Veredicto {
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

    const mensajes: ToolMessage[] = [];
    const pendientes: OperacionPendiente[] = [];
    for (const llamada of llamadas) {
      const veredicto = validarLlamadaVentas(state, llamada);
      if (veredicto.ok) pendientes.push(veredicto.operacion);
      else mensajes.push(new ToolMessage({ content: veredicto.motivo, tool_call_id: llamada.id, name: llamada.nombre }));
    }
    return { messages: mensajes, pendientes };
  };
}
