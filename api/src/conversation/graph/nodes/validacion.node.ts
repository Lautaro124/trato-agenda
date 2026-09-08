/**
 * Nodo de validación de agenda: código puro, sin modelo y sin Google. Toma las
 * tool calls que pidió el nodo de conversación y decide cuáles pueden
 * ejecutarse, aplicando las tres reglas duras (franja de atención, margen
 * mínimo y no superponer) contra el snapshot que ya cargó `cargar_contexto`.
 * Lo que rechaza vuelve al modelo como ToolMessage, sin haber tocado nada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { esAccionValida } from '../../../agents/agent-catalog.js';
import type { PeriodoOcupado } from '../../../calendar/calendar.service.js';
import { ESQUEMAS_ACCIONES, ESQUEMAS_PROPIETARIO } from '../../conversation-tools.js';
import {
  MARGEN_MINIMO_MIN,
  type AgentFranja,
  claveDia,
  conMargen,
  conflictos,
  dentroDeFranja,
  detalleOcupados,
  detalleSugerencias,
  esDiaHabil,
  fechaEnDia,
  formatearFecha,
  horaLocal,
  horariosCercanos,
  mensajeDiaNoHabil,
  mensajeFueraDeFranja,
  mensajeOcupado,
  ocupadosEnRango,
  parsearFecha,
  resumenDelDia,
} from '../agenda-rules.js';
import { duracionMinima } from './cargar-contexto.node.js';
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

/**
 * Alternativa libre más cercana a lo pedido, para que el rechazo no sea sólo un
 * "no": el modelo recibe el horario concreto que sí puede ofrecer.
 */
function sugerencia(state: EstadoConversacionValue, ocupados: PeriodoOcupado[], inicio: Date, fin: Date): string {
  const alternativas = detalleSugerencias(
    horariosCercanos(state.contexto.agent, ocupados, inicio, fin, state.agenda.desde, state.agenda.hasta),
  );
  return alternativas ? ` Lo más cercano que tengo libre es ${alternativas}.` : '';
}

function chequearHorario(
  state: EstadoConversacionValue,
  ocupadosBase: PeriodoOcupado[],
  inicio: Date,
  fin: Date,
  ignorar?: { inicio: Date; fin: Date },
): Veredicto {
  const { agent } = state.contexto;

  if (fin <= inicio) {
    return { ok: false, motivo: 'El fin del turno tiene que ser posterior al inicio. Recalculá el horario y reintentá.' };
  }
  if (!esDiaHabil(claveDia(inicio))) {
    const alternativas = state.agenda.falla ? '' : sugerencia(state, ocupadosBase, inicio, fin);
    return { ok: false, motivo: `${mensajeDiaNoHabil()}${alternativas}` };
  }
  if (!dentroDeFranja(agent, inicio, fin)) {
    const alternativas = state.agenda.falla ? '' : sugerencia(state, ocupadosBase, inicio, fin);
    return { ok: false, motivo: `${mensajeFueraDeFranja(agent)}${alternativas}` };
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

  const choques = conflictos(ocupadosEnRango(ocupadosBase, desde, hasta), ignorar);
  if (choques.length > 0) {
    return {
      ok: false,
      motivo: mensajeOcupado(
        agent,
        conflictos(ocupadosBase, ignorar),
        choques,
        inicio,
        fin,
        state.agenda.desde,
        state.agenda.hasta,
      ),
    };
  }
  return OK;
}

/**
 * true si la consulta es por un día entero (o por un fin de semana, que se
 * responde igual de corto): mismo día de punta a punta y cubriendo la franja de
 * atención completa. Una consulta más angosta ("¿tenés algo el martes a la
 * mañana?") NO cuenta: si la tomáramos como un día entero le contestaríamos con
 * horarios de la tarde y le pediríamos que elija mañana o tarde algo que el
 * cliente ya dijo.
 */
function esConsultaDeUnDia(agent: AgentFranja, desde: Date, hasta: Date): boolean {
  const dia = claveDia(desde);
  // `hasta - 1ms`: "de las 00:00 del martes a las 00:00 del miércoles" es un día.
  const mismoDia = dia === claveDia(new Date(Math.max(hasta.getTime() - 1, desde.getTime())));
  if (!mismoDia) return false;
  if (!esDiaHabil(dia)) return true;

  // El cierre se compara como Date y no como "HH:MM" para que "hasta las 00:00
  // del día siguiente" cuente como que cubre la franja.
  return horaLocal(desde) <= agent.horaDesde && hasta.getTime() >= fechaEnDia(dia, agent.horaHasta).getTime();
}

/**
 * `consultar_disponibilidad` se responde acá mismo con el snapshot: mientras el
 * rango caiga en la ventana ya leída, no hace falta volver a llamar a Google.
 */
function responderDisponibilidad(
  state: EstadoConversacionValue,
  ocupadosBase: PeriodoOcupado[],
  desde: Date,
  hasta: Date,
): string {
  const { agent } = state.contexto;
  const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
  const ocupados = ocupadosEnRango(ocupadosBase, desdeMargen, hastaMargen);
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
    `Períodos ocupados: ${detalleOcupados(ocupados)}.${sugerencia(state, ocupadosBase, desde, hasta)}${franja}`
  );
}

type Resultado =
  | { tipo: 'respuesta'; texto: string }
  /** `reserva` es el rango que la operación va a ocupar: se anota para que otra tool call del mismo mensaje no lo pise. */
  | { tipo: 'pendiente'; operacion: OperacionPendiente; reserva?: PeriodoOcupado };

function validarLlamada(
  state: EstadoConversacionValue,
  ocupadosBase: PeriodoOcupado[],
  llamada: OperacionPendiente,
): Resultado {
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

  const pendiente = { tipo: 'pendiente', operacion: llamada } as const;

  switch (nombre) {
    case 'consultar_disponibilidad': {
      const desde = parsearFecha(args.desde, 'desde');
      const hasta = parsearFecha(args.hasta, 'hasta');
      const { agent } = state.contexto;
      const dia = claveDia(desde);
      const resumenCorto = () => ({
        tipo: 'respuesta' as const,
        texto: resumenDelDia(
          agent,
          ocupadosBase,
          dia,
          state.agenda.desde,
          state.agenda.hasta,
          duracionMinima(agent),
        ),
      });

      // Un fin de semana se contesta siempre igual ("no se atiende"), esté o no
      // dentro de la ventana cargada: no hace falta leer Google para saberlo, y
      // si no lo cortáramos acá el agente podría ofrecer un sábado que después
      // el propio nodo de validación se niega a agendar.
      if (esConsultaDeUnDia(agent, desde, hasta) && !esDiaHabil(dia)) {
        return resumenCorto();
      }

      // "¿Qué tenés el martes?" se contesta con el resumen corto del día: es lo
      // que evita que el agente le vuelque la agenda entera al cliente. Se exige
      // que la jornada entera esté dentro de la ventana ya leída: el último día
      // de la ventana está cargado sólo hasta la hora actual, y resumirlo sin
      // eso ofrecería huecos que nunca se consultaron (y que después
      // `chequearHorario` rechaza por quedar fuera de los días cargados).
      const diaCargado = fechaEnDia(dia, agent.horaHasta) <= state.agenda.hasta;
      if (!state.agenda.falla && diaCargado && esConsultaDeUnDia(agent, desde, hasta)) {
        return resumenCorto();
      }

      const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
      // Fuera de la ventana precargada (o con la agenda caída) sí hay que ir a Google.
      if (state.agenda.falla || !dentroDeVentana(state.agenda, desdeMargen, hastaMargen)) {
        return pendiente;
      }
      return { tipo: 'respuesta', texto: responderDisponibilidad(state, ocupadosBase, desde, hasta) };
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
      const veredicto = chequearHorario(state, ocupadosBase, inicio, fin);
      if (!veredicto.ok) {
        return { tipo: 'respuesta', texto: `No se pudo agendar: ${veredicto.motivo}` };
      }
      return { ...pendiente, reserva: { inicio, fin } };
    }

    case 'reprogramar_turno': {
      const turno = state.contexto.turnoActivo;
      if (!turno) {
        return { tipo: 'respuesta', texto: 'No hay ningún turno activo para reprogramar en esta conversación.' };
      }
      const inicio = parsearFecha(args.inicio, 'inicio');
      const fin = parsearFecha(args.fin, 'fin');
      const veredicto = chequearHorario(state, ocupadosBase, inicio, fin, { inicio: turno.inicio, fin: turno.fin });
      if (!veredicto.ok) {
        return { tipo: 'respuesta', texto: `No se pudo reprogramar: ${veredicto.motivo}` };
      }
      return { ...pendiente, reserva: { inicio, fin } };
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
    /**
     * Rangos ya aprobados en este mismo mensaje. Sin esto, dos `crear_turno` en
     * una sola respuesta del modelo se validan los dos contra la misma foto de
     * la agenda y terminan superpuestos.
     */
    const provisorios: PeriodoOcupado[] = [];

    for (const llamada of llamadas) {
      let resultado: Resultado;
      try {
        resultado = validarLlamada(state, [...state.agenda.ocupados, ...provisorios], llamada);
      } catch (error) {
        resultado = { tipo: 'respuesta', texto: (error as Error).message };
      }

      if (resultado.tipo === 'respuesta') {
        mensajes.push(new ToolMessage({ content: resultado.texto, tool_call_id: llamada.id, name: llamada.nombre }));
      } else {
        pendientes.push(resultado.operacion);
        if (resultado.reserva) provisorios.push(resultado.reserva);
      }
    }

    return { messages: mensajes, pendientes };
  };
}

