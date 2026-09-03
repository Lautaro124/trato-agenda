import type { CalendarService } from '../calendar/calendar.service.js';
import type { AccionId } from '../agents/agent-catalog.js';
import type { PeriodoOcupado } from '../calendar/calendar.service.js';
import type { ToolDefinition } from '../agents/openrouter.client.js';
import type { Agent, User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Colchón mínimo entre un turno y el siguiente. Se aplica ensanchando el rango
 * que se le consulta a freeBusy, así el chequeo de superposición y el de margen
 * son la misma operación.
 */
export const MARGEN_MINIMO_MIN = 5;

const formateador = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Hora local "HH:MM" en TIMEZONE, comparable contra Agent.horaDesde/horaHasta. */
const formateadorHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatearFecha(fecha: Date): string {
  return formateador.format(fecha);
}

function horaLocal(fecha: Date): string {
  // es-AR devuelve "24:00" a la medianoche; normalizarlo a "00:00".
  return formateadorHora.format(fecha).replace(/^24:/, '00:');
}

/** El rango del turno más el margen mínimo de cada lado. */
function conMargen(inicio: Date, fin: Date): [Date, Date] {
  const margenMs = MARGEN_MINIMO_MIN * 60_000;
  return [new Date(inicio.getTime() - margenMs), new Date(fin.getTime() + margenMs)];
}

/**
 * Períodos ocupados que realmente bloquean el horario, descartando el evento
 * del propio turno cuando se está reprogramando: sin esto, mover un turno unos
 * minutos choca contra sí mismo por culpa del margen.
 */
function conflictos(
  ocupados: PeriodoOcupado[],
  ignorar?: { inicio: Date; fin: Date },
): PeriodoOcupado[] {
  if (!ignorar) return ocupados;
  return ocupados.filter(
    (periodo) =>
      periodo.inicio.getTime() !== ignorar.inicio.getTime() ||
      periodo.fin.getTime() !== ignorar.fin.getTime(),
  );
}

function detalleOcupados(ocupados: PeriodoOcupado[]): string {
  return ocupados
    .map((periodo) => `${formatearFecha(periodo.inicio)} a ${formatearFecha(periodo.fin)}`)
    .join('; ');
}

type AgentFranja = Pick<Agent, 'horaDesde' | 'horaHasta'>;

/** true si el turno entero entra en la franja de atención del dueño. */
function dentroDeFranja(agent: AgentFranja, inicio: Date, fin: Date): boolean {
  const desde = horaLocal(inicio);
  const hasta = horaLocal(fin);
  // Un turno que cruza la medianoche siempre cae fuera de la franja.
  if (hasta <= desde) return false;
  return desde >= agent.horaDesde && hasta <= agent.horaHasta;
}

function mensajeFueraDeFranja(agent: AgentFranja): string {
  return (
    `Ese horario queda fuera de la franja de atención (de ${agent.horaDesde} a ${agent.horaHasta}). ` +
    'Ofrecé un horario dentro de esa franja.'
  );
}

/** `new Date(valor)` sin fallar silenciosamente en algo tipo "Invalid Date". */
function parsearFecha(valor: unknown, campo: string): Date {
  if (typeof valor !== 'string') {
    throw new Error(`Falta o es inválido el campo "${campo}" (tiene que ser string ISO 8601).`);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`El campo "${campo}" no es una fecha ISO 8601 válida: "${valor}".`);
  }
  return fecha;
}

export type ToolContext = {
  user: User;
  agent: Agent;
  conversationId: string;
  calendarService: CalendarService;
  prisma: PrismaService;
};

export type Tool = {
  id: AccionId;
  definition: ToolDefinition;
  /** Nunca lanza por errores de negocio (ej "no hay turno activo") — devuelve el mensaje como string. Sí puede lanzar CalendarUnavailableError. */
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<string>;
};

const consultarDisponibilidad: Tool = {
  id: 'consultar_disponibilidad',
  definition: {
    type: 'function',
    function: {
      name: 'consultar_disponibilidad',
      description:
        'Consulta si un rango horario está libre en el calendario antes de ofrecérselo al cliente.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Inicio del rango a chequear, ISO 8601 con horario y offset, ej "2026-09-05T14:00:00-03:00".' },
          hasta: { type: 'string', description: 'Fin del rango a chequear, ISO 8601 con horario y offset.' },
        },
        required: ['desde', 'hasta'],
      },
    },
  },
  async execute(ctx, args) {
    const desde = parsearFecha(args.desde, 'desde');
    const hasta = parsearFecha(args.hasta, 'hasta');
    const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
    const ocupados = await ctx.calendarService.freeBusy(ctx.user, desdeMargen, hastaMargen);

    const franja = dentroDeFranja(ctx.agent, desde, hasta)
      ? ''
      : ` Ojo: ese rango se sale de la franja de atención (de ${ctx.agent.horaDesde} a ${ctx.agent.horaHasta}), no lo ofrezcas.`;

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
  },
};

const crearTurno: Tool = {
  id: 'crear_turno',
  definition: {
    type: 'function',
    function: {
      name: 'crear_turno',
      description:
        'Agenda un turno nuevo. Usar sólo después de confirmar disponibilidad, de saber el nombre ' +
        'de la persona y de que el cliente confirmó el horario.',
      parameters: {
        type: 'object',
        properties: {
          nombreCliente: {
            type: 'string',
            description:
              'Nombre de la persona para la que es el turno. Obligatorio: si no lo sabés, preguntáselo antes de llamar esta herramienta.',
          },
          resumen: { type: 'string', description: 'Tipo de turno, ej "Corte de pelo". El nombre se agrega solo.' },
          inicio: { type: 'string', description: 'Inicio del turno, ISO 8601 con horario y offset.' },
          fin: { type: 'string', description: 'Fin del turno, ISO 8601 con horario y offset.' },
        },
        required: ['nombreCliente', 'resumen', 'inicio', 'fin'],
      },
    },
  },
  async execute(ctx, args) {
    const nombreCliente = typeof args.nombreCliente === 'string' ? args.nombreCliente.trim() : '';
    if (!nombreCliente) {
      return 'Antes de agendar necesito el nombre de la persona. Preguntáselo y volvé a intentar.';
    }

    const tipo = typeof args.resumen === 'string' && args.resumen.trim() ? args.resumen.trim() : 'Turno';
    const inicio = parsearFecha(args.inicio, 'inicio');
    const fin = parsearFecha(args.fin, 'fin');

    if (fin <= inicio) {
      return 'El fin del turno tiene que ser posterior al inicio. Recalculá el horario y reintentá.';
    }
    if (!dentroDeFranja(ctx.agent, inicio, fin)) {
      return mensajeFueraDeFranja(ctx.agent);
    }

    const [desde, hasta] = conMargen(inicio, fin);
    const ocupados = await ctx.calendarService.freeBusy(ctx.user, desde, hasta);
    if (ocupados.length > 0) {
      return (
        `No se pudo agendar: ese horario está ocupado o queda a menos de ${MARGEN_MINIMO_MIN} minutos ` +
        `de otro turno (${detalleOcupados(ocupados)}). Ofrecé otro horario.`
      );
    }

    const googleEventId = await ctx.calendarService.crearEvento(ctx.user, {
      resumen: `${tipo} - ${nombreCliente}`,
      inicio,
      fin,
    });
    await ctx.prisma.turno.create({
      data: {
        conversationId: ctx.conversationId,
        googleEventId,
        nombreCliente,
        inicio,
        fin,
        estado: 'confirmado',
      },
    });
    // Se pregunta una vez y queda en la conversación para los turnos siguientes.
    await ctx.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { nombreCliente },
    });

    return `Turno agendado para ${nombreCliente} el ${formatearFecha(inicio)}.`;
  },
};

async function buscarTurnoActivo(ctx: ToolContext) {
  return ctx.prisma.turno.findFirst({
    where: { conversationId: ctx.conversationId, estado: 'confirmado' },
    orderBy: { createdAt: 'desc' },
  });
}

const cancelarTurno: Tool = {
  id: 'cancelar_turno',
  definition: {
    type: 'function',
    function: {
      name: 'cancelar_turno',
      description: 'Cancela el turno vigente de esta conversación. No recibe parámetros.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  async execute(ctx) {
    const turno = await buscarTurnoActivo(ctx);
    if (!turno) {
      return 'No hay ningún turno activo para cancelar en esta conversación.';
    }

    await ctx.calendarService.cancelarEvento(ctx.user, turno.googleEventId);
    await ctx.prisma.turno.update({ where: { id: turno.id }, data: { estado: 'cancelado' } });

    return `Turno del ${formatearFecha(turno.inicio)} cancelado.`;
  },
};

const reprogramarTurno: Tool = {
  id: 'reprogramar_turno',
  definition: {
    type: 'function',
    function: {
      name: 'reprogramar_turno',
      description: 'Mueve el turno vigente de esta conversación a un nuevo horario.',
      parameters: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'Nuevo inicio, ISO 8601 con horario y offset.' },
          fin: { type: 'string', description: 'Nuevo fin, ISO 8601 con horario y offset.' },
        },
        required: ['inicio', 'fin'],
      },
    },
  },
  async execute(ctx, args) {
    const turno = await buscarTurnoActivo(ctx);
    if (!turno) {
      return 'No hay ningún turno activo para reprogramar en esta conversación.';
    }

    const inicio = parsearFecha(args.inicio, 'inicio');
    const fin = parsearFecha(args.fin, 'fin');

    if (fin <= inicio) {
      return 'El fin del turno tiene que ser posterior al inicio. Recalculá el horario y reintentá.';
    }
    if (!dentroDeFranja(ctx.agent, inicio, fin)) {
      return mensajeFueraDeFranja(ctx.agent);
    }

    const [desde, hasta] = conMargen(inicio, fin);
    const ocupados = conflictos(await ctx.calendarService.freeBusy(ctx.user, desde, hasta), {
      inicio: turno.inicio,
      fin: turno.fin,
    });
    if (ocupados.length > 0) {
      return (
        `No se pudo reprogramar: ese horario está ocupado o queda a menos de ${MARGEN_MINIMO_MIN} ` +
        `minutos de otro turno (${detalleOcupados(ocupados)}). Ofrecé otro horario.`
      );
    }

    await ctx.calendarService.reprogramarEvento(ctx.user, turno.googleEventId, { inicio, fin });
    await ctx.prisma.turno.update({ where: { id: turno.id }, data: { inicio, fin } });

    return `Turno reprogramado para ${formatearFecha(inicio)}.`;
  },
};

const consultarTurno: Tool = {
  id: 'consultar_turno',
  definition: {
    type: 'function',
    function: {
      name: 'consultar_turno',
      description: 'Busca los turnos ya agendados en esta conversación. No recibe parámetros.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  async execute(ctx) {
    const turnos = await ctx.prisma.turno.findMany({
      where: { conversationId: ctx.conversationId, estado: 'confirmado' },
      orderBy: { inicio: 'asc' },
    });

    if (turnos.length === 0) {
      return 'No hay turnos agendados en esta conversación.';
    }
    return turnos
      .map(
        (turno) =>
          `Turno el ${formatearFecha(turno.inicio)}${turno.nombreCliente ? ` a nombre de ${turno.nombreCliente}` : ''}.`,
      )
      .join(' ');
  },
};

/** Un tool por cada acción de agent-catalog.ts — mismos ids. */
export const TOOLS: Record<AccionId, Tool> = {
  consultar_disponibilidad: consultarDisponibilidad,
  crear_turno: crearTurno,
  cancelar_turno: cancelarTurno,
  reprogramar_turno: reprogramarTurno,
  consultar_turno: consultarTurno,
};

/**
 * Tools que sólo se ofrecen cuando quien habla es el dueño (el banco de
 * pruebas del Home, nunca un cliente real de WhatsApp — ver
 * conversation.service.ts `esConversacionDePrueba`). A diferencia de
 * `Tool`, no tienen un `AccionId` de agent-catalog.ts: no son algo que el
 * meta-agente pueda habilitarle a un agente que atiende clientes, porque le
 * darían acceso a cualquier evento del calendario del dueño, no sólo a los
 * turnos de esa conversación puntual.
 */
export type ToolPropietario = {
  id: string;
  definition: ToolDefinition;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<string>;
};

function parsearFechaOpcional(valor: unknown, campo: string): Date | undefined {
  if (valor === undefined) return undefined;
  return parsearFecha(valor, campo);
}

const listarEventosCalendario: ToolPropietario = {
  id: 'listar_eventos_calendario',
  definition: {
    type: 'function',
    function: {
      name: 'listar_eventos_calendario',
      description:
        'Lista TODOS los eventos del Google Calendar del dueño en un rango de fechas, no sólo los agendados ' +
        'en esta conversación. Usar antes de cancelar_evento_calendario o editar_evento_calendario para ' +
        'encontrar el id del evento correcto.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Inicio del rango, ISO 8601 con horario y offset.' },
          hasta: { type: 'string', description: 'Fin del rango, ISO 8601 con horario y offset.' },
        },
        required: ['desde', 'hasta'],
      },
    },
  },
  async execute(ctx, args) {
    const desde = parsearFecha(args.desde, 'desde');
    const hasta = parsearFecha(args.hasta, 'hasta');
    const eventos = await ctx.calendarService.listarProximos(ctx.user, desde, hasta);

    if (eventos.length === 0) {
      return `No hay eventos en el calendario entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}.`;
    }
    return eventos
      .map((evento) => `id=${evento.id} · ${evento.resumen || '(sin título)'} · ${evento.inicio ? formatearFecha(evento.inicio) : 'sin horario'}`)
      .join('\n');
  },
};

const cancelarEventoCalendario: ToolPropietario = {
  id: 'cancelar_evento_calendario',
  definition: {
    type: 'function',
    function: {
      name: 'cancelar_evento_calendario',
      description:
        'Cancela (elimina) un evento del Google Calendar del dueño por su id. Flujo obligatorio en dos pasos: ' +
        '1) usá listar_eventos_calendario para encontrar el evento y mostrale al dueño de cuál se trata (fecha, ' +
        'horario y título) y esperá que confirme por texto; 2) recién cuando confirme, llamá esta herramienta ' +
        'de nuevo con confirmado: true. Nunca mandes confirmado: true sin que el dueño haya confirmado antes.',
      parameters: {
        type: 'object',
        properties: {
          eventoId: { type: 'string', description: 'Id del evento, obtenido con listar_eventos_calendario.' },
          confirmado: {
            type: 'boolean',
            description: 'true sólo si el dueño ya vio el evento (fecha, horario, título) y confirmó por texto que quiere cancelarlo.',
          },
        },
        required: ['eventoId', 'confirmado'],
      },
    },
  },
  async execute(ctx, args) {
    if (typeof args.eventoId !== 'string' || !args.eventoId.trim()) {
      return 'Falta el id del evento a cancelar. Usá listar_eventos_calendario primero.';
    }
    if (args.confirmado !== true) {
      return 'Todavía no está confirmado. Mostrale al dueño el evento (fecha, horario, título) y pedile que confirme antes de ejecutar esta acción.';
    }
    await ctx.calendarService.eliminarEventoDesdeAgenda(ctx.user, ctx.user.id, args.eventoId);
    return 'Evento cancelado.';
  },
};

const editarEventoCalendario: ToolPropietario = {
  id: 'editar_evento_calendario',
  definition: {
    type: 'function',
    function: {
      name: 'editar_evento_calendario',
      description:
        'Edita horario y/o título de un evento del Google Calendar del dueño por su id. Mandá sólo los ' +
        'campos que cambian. Flujo obligatorio en dos pasos: 1) usá listar_eventos_calendario para encontrar ' +
        'el evento y mostrale al dueño de cuál se trata (fecha, horario y título) junto con el cambio propuesto, ' +
        'y esperá que confirme por texto; 2) recién cuando confirme, llamá esta herramienta de nuevo con ' +
        'confirmado: true. Nunca mandes confirmado: true sin que el dueño haya confirmado antes.',
      parameters: {
        type: 'object',
        properties: {
          eventoId: { type: 'string', description: 'Id del evento, obtenido con listar_eventos_calendario.' },
          inicio: { type: 'string', description: 'Nuevo inicio, ISO 8601 con horario y offset (opcional).' },
          fin: { type: 'string', description: 'Nuevo fin, ISO 8601 con horario y offset (opcional).' },
          resumen: { type: 'string', description: 'Nuevo título del evento (opcional).' },
          confirmado: {
            type: 'boolean',
            description: 'true sólo si el dueño ya vio el evento y el cambio propuesto, y confirmó por texto que quiere editarlo.',
          },
        },
        required: ['eventoId', 'confirmado'],
      },
    },
  },
  async execute(ctx, args) {
    if (typeof args.eventoId !== 'string' || !args.eventoId.trim()) {
      return 'Falta el id del evento a editar. Usá listar_eventos_calendario primero.';
    }
    if (args.confirmado !== true) {
      return 'Todavía no está confirmado. Mostrale al dueño el evento (fecha, horario, título) y el cambio propuesto, y pedile que confirme antes de ejecutar esta acción.';
    }
    const inicio = parsearFechaOpcional(args.inicio, 'inicio');
    const fin = parsearFechaOpcional(args.fin, 'fin');
    const resumen = typeof args.resumen === 'string' ? args.resumen.trim() : undefined;

    if (!inicio && !fin && !resumen) {
      return 'No mandaste ningún cambio (inicio, fin o resumen). No se editó nada.';
    }

    await ctx.calendarService.editarEventoDesdeAgenda(ctx.user, ctx.user.id, args.eventoId, {
      ...(inicio ? { inicio } : {}),
      ...(fin ? { fin } : {}),
      ...(resumen ? { resumen } : {}),
    });
    return 'Evento actualizado.';
  },
};

export const HERRAMIENTAS_PROPIETARIO: Record<string, ToolPropietario> = {
  listar_eventos_calendario: listarEventosCalendario,
  cancelar_evento_calendario: cancelarEventoCalendario,
  editar_evento_calendario: editarEventoCalendario,
};
