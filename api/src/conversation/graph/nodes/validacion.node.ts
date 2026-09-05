/**
 * Nodo de validación de agenda: código puro, sin modelo y sin Google. Toma las
 * tool calls que pidió el nodo de conversación y decide cuáles pueden
 * ejecutarse, aplicando las tres reglas duras (franja de atención, margen
 * mínimo y no superponer) contra el snapshot que ya cargó `cargar_contexto`.
 * Lo que rechaza vuelve al modelo como ToolMessage, sin haber tocado nada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { esAccionValida } from '../../../agents/agent-catalog.js';
import { ESQUEMAS_ACCIONES, ESQUEMAS_PROPIETARIO } from '../../conversation-tools.js';
import {
  MARGEN_MINIMO_MIN,
  conMargen,
  conflictos,
  dentroDeFranja,
  detalleOcupados,
  formatearFecha,
  mensajeFueraDeFranja,
  ocupadosEnRango,
  parsearFecha,
} from '../agenda-rules.js';
import {
  llamadasDe,
  type EstadoConversacionUpdate,
  type EstadoConversacionValue,
  type OperacionPendiente,
  type SnapshotAgenda,
} from '../state.js';

type Veredicto = { ok: true } | { ok: false; motivo: string };

const OK: Veredicto = { ok: true };

/** true si el rango pedido entra entero en la ventana que ya se leyó de Google. */
function dentroDeVentana(agenda: SnapshotAgenda, desde: Date, hasta: Date): boolean {
  return desde >= agenda.desde && hasta <= agenda.hasta;
}

function chequearHorario(
  state: EstadoConversacionValue,
  inicio: Date,
  fin: Date,
  ignorar?: { inicio: Date; fin: Date },
): Veredicto {
  const { agent } = state.contexto;

  if (fin <= inicio) {
    return { ok: false, motivo: 'El fin del turno tiene que ser posterior al inicio. Recalculá el horario y reintentá.' };
  }
  if (!dentroDeFranja(agent, inicio, fin)) {
    return { ok: false, motivo: mensajeFueraDeFranja(agent) };
  }
  if (state.agenda.falla) {
    return {
      ok: false,
      motivo:
        'No se pudo leer la agenda de Google Calendar, así que no puedo confirmar que ese horario esté libre. ' +
        'Pedile disculpas al cliente y decile que se está revisando.',
    };
  }

  const [desde, hasta] = conMargen(inicio, fin);
  if (!dentroDeVentana(state.agenda, desde, hasta)) {
    return {
      ok: false,
      motivo:
        `Ese horario queda fuera de los próximos días que tengo cargados. Ofrecé una fecha más cercana ` +
        `(hasta el ${formatearFecha(state.agenda.hasta)}).`,
    };
  }

  const ocupados = conflictos(ocupadosEnRango(state.agenda.ocupados, desde, hasta), ignorar);
  if (ocupados.length > 0) {
    return {
      ok: false,
      motivo:
        `Ese horario está ocupado o queda a menos de ${MARGEN_MINIMO_MIN} minutos de otro turno ` +
        `(${detalleOcupados(ocupados)}). Ofrecé otro horario.`,
    };
  }
  return OK;
}

/**
 * `consultar_disponibilidad` se responde acá mismo con el snapshot: mientras el
 * rango caiga en la ventana ya leída, no hace falta volver a llamar a Google.
 */
function responderDisponibilidad(state: EstadoConversacionValue, desde: Date, hasta: Date): string {
  const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
  const ocupados = ocupadosEnRango(state.agenda.ocupados, desdeMargen, hastaMargen);
  const { agent } = state.contexto;
  const franja = dentroDeFranja(agent, desde, hasta)
    ? ''
    : ` Ojo: ese rango se sale de la franja de atención (de ${agent.horaDesde} a ${agent.horaHasta}), no lo ofrezcas.`;

  if (ocupados.length === 0) {
    return (
      `Libre: no hay nada agendado entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}, ` +
      `contando ${MARGEN_MINIMO_MIN} minutos de margen antes y después.${franja}`
    );
  }
  return (
    `Ocupado en ese rango (o a menos de ${MARGEN_MINIMO_MIN} minutos de algo agendado). ` +
    `Períodos ocupados: ${detalleOcupados(ocupados)}. Ofrecé otro horario.${franja}`
  );
}

type Resultado =
  | { tipo: 'respuesta'; texto: string }
  | { tipo: 'pendiente'; operacion: OperacionPendiente };

function validarLlamada(state: EstadoConversacionValue, llamada: OperacionPendiente): Resultado {
  const { nombre, args } = llamada;
  const esquema = state.esPropietario
    ? (ESQUEMAS_PROPIETARIO[nombre] ??
      (esAccionValida(nombre) ? ESQUEMAS_ACCIONES[nombre] : undefined))
    : esAccionValida(nombre)
      ? ESQUEMAS_ACCIONES[nombre]
      : undefined;

  const habilitada =
    (state.esPropietario && Object.hasOwn(ESQUEMAS_PROPIETARIO, nombre)) ||
    (esAccionValida(nombre) && state.contexto.agent.allowedActions.includes(nombre));
  if (!esquema || !habilitada) {
    return { tipo: 'respuesta', texto: `La acción "${nombre}" no está habilitada para este agente.` };
  }

  const parseo = esquema.schema.safeParse(args);
  if (!parseo.success) {
    const detalle = parseo.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return {
      tipo: 'respuesta',
      texto: `Los parámetros de "${nombre}" no son válidos: ${detalle}. Reintentá con el formato correcto.`,
    };
  }

  const pendiente: Resultado = { tipo: 'pendiente', operacion: llamada };

  switch (nombre) {
    case 'consultar_disponibilidad': {
      const desde = parsearFecha(args.desde, 'desde');
      const hasta = parsearFecha(args.hasta, 'hasta');
      const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
      // Fuera de la ventana precargada (o con la agenda caída) sí hay que ir a Google.
      if (state.agenda.falla || !dentroDeVentana(state.agenda, desdeMargen, hastaMargen)) {
        return pendiente;
      }
      return { tipo: 'respuesta', texto: responderDisponibilidad(state, desde, hasta) };
    }

    case 'crear_turno': {
      const nombreCliente = typeof args.nombreCliente === 'string' ? args.nombreCliente.trim() : '';
      if (!nombreCliente) {
        return {
          tipo: 'respuesta',
          texto: 'Antes de agendar necesito el nombre de la persona. Preguntáselo y volvé a intentar.',
        };
      }
      const inicio = parsearFecha(args.inicio, 'inicio');
      const fin = parsearFecha(args.fin, 'fin');
      const veredicto = chequearHorario(state, inicio, fin);
      if (!veredicto.ok) {
        return { tipo: 'respuesta', texto: `No se pudo agendar: ${veredicto.motivo}` };
      }
      return pendiente;
    }

    case 'reprogramar_turno': {
      const turno = state.contexto.turnoActivo;
      if (!turno) {
        return { tipo: 'respuesta', texto: 'No hay ningún turno activo para reprogramar en esta conversación.' };
      }
      const inicio = parsearFecha(args.inicio, 'inicio');
      const fin = parsearFecha(args.fin, 'fin');
      const veredicto = chequearHorario(state, inicio, fin, { inicio: turno.inicio, fin: turno.fin });
      if (!veredicto.ok) {
        return { tipo: 'respuesta', texto: `No se pudo reprogramar: ${veredicto.motivo}` };
      }
      return pendiente;
    }

    case 'cancelar_turno': {
      if (!state.contexto.turnoActivo) {
        return { tipo: 'respuesta', texto: 'No hay ningún turno activo para cancelar en esta conversación.' };
      }
      return pendiente;
    }

    case 'cancelar_evento_calendario':
      if (args.confirmado !== true) {
        return {
          tipo: 'respuesta',
          texto:
            'Todavía no está confirmado. Mostrale al dueño el evento (fecha, horario, título) y pedile que ' +
            'confirme antes de ejecutar esta acción.',
        };
      }
      return pendiente;

    case 'editar_evento_calendario': {
      if (args.confirmado !== true) {
        return {
          tipo: 'respuesta',
          texto:
            'Todavía no está confirmado. Mostrale al dueño el evento (fecha, horario, título) y el cambio ' +
            'propuesto, y pedile que confirme antes de ejecutar esta acción.',
        };
      }
      if (args.inicio === undefined && args.fin === undefined && args.resumen === undefined) {
        return { tipo: 'respuesta', texto: 'No mandaste ningún cambio (inicio, fin o resumen). No se editó nada.' };
      }
      return pendiente;
    }

    default:
      // consultar_turno y listar_eventos_calendario: sólo lectura, no hay nada que validar.
      return pendiente;
  }
}

export function crearNodoValidacion() {
  return async (state: EstadoConversacionValue): Promise<EstadoConversacionUpdate> => {
    const ultimo = state.messages.at(-1);
    const llamadas = llamadasDe(
      ultimo && ultimo.getType() === 'ai' ? (ultimo as { tool_calls?: never[] }).tool_calls : undefined,
    );

    const mensajes: ToolMessage[] = [];
    const pendientes: OperacionPendiente[] = [];

    for (const llamada of llamadas) {
      let resultado: Resultado;
      try {
        resultado = validarLlamada(state, llamada);
      } catch (error) {
        resultado = { tipo: 'respuesta', texto: (error as Error).message };
      }

      if (resultado.tipo === 'respuesta') {
        mensajes.push(new ToolMessage({ content: resultado.texto, tool_call_id: llamada.id, name: llamada.nombre }));
      } else {
        pendientes.push(resultado.operacion);
      }
    }

    return { messages: mensajes, pendientes };
  };
}

