/**
 * Validación de las tool calls del asistente de ventas: código puro, sin base
 * ni red. Revisa que la herramienta exista para este agente y que los
 * argumentos cumplan su schema. Lo que rechaza vuelve al modelo como
 * ToolMessage; lo que pasa, lo ejecuta el nodo `catalogo`.
 */
import { ToolMessage } from '@langchain/core/messages';
import { esAccionDeVentas } from '../../../agents/agent-catalog.js';
import type { EsquemaHerramienta } from '../../conversation-tools.js';
import { llamadasDe, type OperacionPendiente } from '../../graph/state.js';
import { ESQUEMAS_PROPIETARIO_VENTAS, ESQUEMAS_VENTAS } from '../ventas-tools.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

/** Largo máximo de una consulta al catálogo: lo que pase de eso no es una búsqueda. */
export const MAX_LARGO_CONSULTA = 200;

type Veredicto = { ok: true; operacion: OperacionPendiente } | { ok: false; motivo: string };

function esquemaPara(state: EstadoVentasValue, nombre: string): EsquemaHerramienta | undefined {
  if (esAccionDeVentas(nombre) && state.contexto.agent.allowedActions.includes(nombre)) {
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
