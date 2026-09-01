import type { CalendarService } from '../calendar/calendar.service.js';
import type { AccionId } from '../agents/agent-catalog.js';
import type { ToolDefinition } from '../agents/openrouter.client.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

const formateador = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

function formatearFecha(fecha: Date): string {
  return formateador.format(fecha);
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
    const ocupados = await ctx.calendarService.freeBusy(ctx.user, desde, hasta);

    if (ocupados.length === 0) {
      return `Libre: no hay nada agendado entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}.`;
    }
    const detalle = ocupados
      .map((periodo) => `${formatearFecha(periodo.inicio)} a ${formatearFecha(periodo.fin)}`)
      .join('; ');
    return `Ocupado en ese rango. Períodos ocupados: ${detalle}. Ofrecé otro horario.`;
  },
};

const crearTurno: Tool = {
  id: 'crear_turno',
  definition: {
    type: 'function',
    function: {
      name: 'crear_turno',
      description:
        'Agenda un turno nuevo. Usar sólo después de confirmar disponibilidad y que el cliente confirmó el horario.',
      parameters: {
        type: 'object',
        properties: {
          resumen: { type: 'string', description: 'Título corto del turno, ej "Corte de pelo - Juan".' },
          inicio: { type: 'string', description: 'Inicio del turno, ISO 8601 con horario y offset.' },
          fin: { type: 'string', description: 'Fin del turno, ISO 8601 con horario y offset.' },
        },
        required: ['resumen', 'inicio', 'fin'],
      },
    },
  },
  async execute(ctx, args) {
    const resumen = typeof args.resumen === 'string' && args.resumen.trim() ? args.resumen.trim() : 'Turno';
    const inicio = parsearFecha(args.inicio, 'inicio');
    const fin = parsearFecha(args.fin, 'fin');

    const ocupados = await ctx.calendarService.freeBusy(ctx.user, inicio, fin);
    if (ocupados.length > 0) {
      return `No se pudo agendar: ese horario se ocupó justo ahora. Consultá disponibilidad de nuevo y ofrecé otro.`;
    }

    const googleEventId = await ctx.calendarService.crearEvento(ctx.user, { resumen, inicio, fin });
    await ctx.prisma.turno.create({
      data: { conversationId: ctx.conversationId, googleEventId, inicio, fin, estado: 'confirmado' },
    });

    return `Turno agendado para ${formatearFecha(inicio)}.`;
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

    const ocupados = await ctx.calendarService.freeBusy(ctx.user, inicio, fin);
    if (ocupados.length > 0) {
      return 'No se pudo reprogramar: ese horario está ocupado. Consultá disponibilidad de nuevo y ofrecé otro.';
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
    return turnos.map((turno) => `Turno el ${formatearFecha(turno.inicio)}.`).join(' ');
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
      description: 'Cancela (elimina) un evento del Google Calendar del dueño por su id.',
      parameters: {
        type: 'object',
        properties: {
          eventoId: { type: 'string', description: 'Id del evento, obtenido con listar_eventos_calendario.' },
        },
        required: ['eventoId'],
      },
    },
  },
  async execute(ctx, args) {
    if (typeof args.eventoId !== 'string' || !args.eventoId.trim()) {
      return 'Falta el id del evento a cancelar. Usá listar_eventos_calendario primero.';
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
        'campos que cambian.',
      parameters: {
        type: 'object',
        properties: {
          eventoId: { type: 'string', description: 'Id del evento, obtenido con listar_eventos_calendario.' },
          inicio: { type: 'string', description: 'Nuevo inicio, ISO 8601 con horario y offset (opcional).' },
          fin: { type: 'string', description: 'Nuevo fin, ISO 8601 con horario y offset (opcional).' },
          resumen: { type: 'string', description: 'Nuevo título del evento (opcional).' },
        },
        required: ['eventoId'],
      },
    },
  },
  async execute(ctx, args) {
    if (typeof args.eventoId !== 'string' || !args.eventoId.trim()) {
      return 'Falta el id del evento a editar. Usá listar_eventos_calendario primero.';
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
