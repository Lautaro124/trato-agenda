/**
 * Nodo de gestión de calendario: la única puerta a Google Calendar y a las
 * filas `Turno`. Ejecuta lo que el nodo de validación ya aprobó contra el
 * snapshot; las reglas de agenda siguen viviendo en agenda-rules.ts y no se
 * reevalúan acá, pero antes de escribir se relee el rango en Google, porque
 * entre la foto del snapshot y este momento pudo entrar otra conversación o el
 * propio dueño cargando algo a mano. Cada operación deja su
 * resultado como ToolMessage y, si cambió la agenda, actualiza el snapshot en
 * memoria para que el resto de la misma vuelta no tenga que releer Google.
 */
import { ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { CalendarService, PeriodoOcupado } from '../../../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../../../calendar/google-calendar.client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { MENSAJE_CALENDAR_CAIDO } from '../../mensajes.js';
import {
  MARGEN_MINIMO_MIN,
  conMargen,
  conflictos,
  detalleOcupados,
  formatearFecha,
  mensajeOcupado,
  parsearFecha,
  parsearFechaOpcional,
} from '../agenda-rules.js';
import type {
  ContextoTurno,
  EstadoConversacionUpdate,
  EstadoConversacionValue,
  OperacionPendiente,
  SnapshotAgenda,
} from '../state.js';

export type DepsCalendar = {
  prisma: PrismaService;
  calendarService: CalendarService;
};

/** Lo que una operación puede cambiar del estado además de su texto de respuesta. */
type Efecto = {
  texto: string;
  agenda?: SnapshotAgenda;
  contexto?: ContextoTurno;
};

function agregarOcupado(agenda: SnapshotAgenda, periodo: PeriodoOcupado): SnapshotAgenda {
  return { ...agenda, ocupados: [...agenda.ocupados, periodo] };
}

/** Suma períodos recién leídos de Google al snapshot, sin duplicar los que ya estaban. */
function fusionarOcupados(agenda: SnapshotAgenda, periodos: PeriodoOcupado[]): SnapshotAgenda {
  const nuevos = periodos.filter(
    (periodo) =>
      !agenda.ocupados.some(
        (otro) =>
          otro.inicio.getTime() === periodo.inicio.getTime() && otro.fin.getTime() === periodo.fin.getTime(),
      ),
  );
  return nuevos.length > 0 ? { ...agenda, ocupados: [...agenda.ocupados, ...nuevos] } : agenda;
}

function quitarOcupado(agenda: SnapshotAgenda, periodo: PeriodoOcupado): SnapshotAgenda {
  return {
    ...agenda,
    ocupados: agenda.ocupados.filter(
      (otro) =>
        otro.inicio.getTime() !== periodo.inicio.getTime() ||
        otro.fin.getTime() !== periodo.fin.getTime(),
    ),
  };
}

export function crearNodoCalendar(deps: DepsCalendar) {
  const logger = new Logger('CalendarNode');

  /**
   * Última barrera contra la superposición: relee en Google sólo el rango del
   * turno (más el margen) justo antes de escribirlo. Es una lectura chica y por
   * turno agendado, no por mensaje. Devuelve el efecto de rechazo, o null si
   * está libre y se puede escribir.
   */
  async function choqueDeUltimoMomento(
    agenda: SnapshotAgenda,
    contexto: ContextoTurno,
    inicio: Date,
    fin: Date,
    ignorar?: PeriodoOcupado,
  ): Promise<Efecto | null> {
    const { agent } = contexto;
    const [desde, hasta] = conMargen(inicio, fin);
    const ocupados = await deps.calendarService.freeBusy(agent.user, desde, hasta);
    const choques = conflictos(ocupados, ignorar);
    if (choques.length === 0) return null;

    // Los ocupados recién leídos entran al snapshot para que la sugerencia sea
    // correcta y el modelo no reintente el mismo horario en la vuelta siguiente.
    const actualizada = fusionarOcupados(agenda, ocupados);
    return {
      texto: mensajeOcupado(
        agent,
        conflictos(actualizada.ocupados, ignorar),
        choques,
        inicio,
        fin,
        actualizada.desde,
        actualizada.hasta,
      ),
      agenda: actualizada,
    };
  }

  async function ejecutar(
    agenda: SnapshotAgenda,
    contexto: ContextoTurno,
    operacion: OperacionPendiente,
  ): Promise<Efecto> {
    const { nombre, args } = operacion;
    const { agent, conversation, turnoActivo } = contexto;

    switch (nombre) {
      case 'consultar_disponibilidad': {
        // Sólo se llega acá cuando el rango cae fuera de la ventana precargada.
        const desde = parsearFecha(args.desde, 'desde');
        const hasta = parsearFecha(args.hasta, 'hasta');
        const [desdeMargen, hastaMargen] = conMargen(desde, hasta);
        const ocupados = await deps.calendarService.freeBusy(agent.user, desdeMargen, hastaMargen);
        if (ocupados.length === 0) {
          return {
            texto:
              `Libre: no hay nada agendado entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}, ` +
              `contando ${MARGEN_MINIMO_MIN} minutos de margen antes y después.`,
          };
        }
        return {
          texto:
            `Ocupado en ese rango (o a menos de ${MARGEN_MINIMO_MIN} minutos de algo agendado). ` +
            `Períodos ocupados: ${detalleOcupados(ocupados)}. Ofrecé otro horario.`,
        };
      }

      case 'crear_turno': {
        const nombreCliente = String(args.nombreCliente).trim();
        const tipo = typeof args.resumen === 'string' && args.resumen.trim() ? args.resumen.trim() : 'Turno';
        const inicio = parsearFecha(args.inicio, 'inicio');
        const fin = parsearFecha(args.fin, 'fin');

        const choque = await choqueDeUltimoMomento(agenda, contexto, inicio, fin);
        if (choque) {
          return { ...choque, texto: `No se pudo agendar: ese horario se ocupó recién. ${choque.texto}` };
        }

        const googleEventId = await deps.calendarService.crearEvento(agent.user, {
          resumen: `${tipo} - ${nombreCliente}`,
          inicio,
          fin,
        });
        const turno = await deps.prisma.turno.create({
          data: {
            conversationId: conversation.id,
            googleEventId,
            nombreCliente,
            inicio,
            fin,
            estado: 'confirmado',
          },
        });
        // Se pregunta una vez y queda en la conversación para los turnos siguientes.
        const conversacionActualizada = await deps.prisma.conversation.update({
          where: { id: conversation.id },
          data: { nombreCliente },
        });

        return {
          texto: `Turno agendado para ${nombreCliente} el ${formatearFecha(inicio)}.`,
          agenda: agregarOcupado(agenda, { inicio, fin }),
          contexto: { ...contexto, conversation: conversacionActualizada, turnoActivo: turno },
        };
      }

      case 'cancelar_turno': {
        if (!turnoActivo) {
          return { texto: 'No hay ningún turno activo para cancelar en esta conversación.' };
        }
        await deps.calendarService.cancelarEvento(agent.user, turnoActivo.googleEventId);
        await deps.prisma.turno.update({ where: { id: turnoActivo.id }, data: { estado: 'cancelado' } });

        return {
          texto: `Turno del ${formatearFecha(turnoActivo.inicio)} cancelado.`,
          agenda: quitarOcupado(agenda, { inicio: turnoActivo.inicio, fin: turnoActivo.fin }),
          contexto: { ...contexto, turnoActivo: null },
        };
      }

      case 'reprogramar_turno': {
        if (!turnoActivo) {
          return { texto: 'No hay ningún turno activo para reprogramar en esta conversación.' };
        }
        const inicio = parsearFecha(args.inicio, 'inicio');
        const fin = parsearFecha(args.fin, 'fin');

        const choque = await choqueDeUltimoMomento(agenda, contexto, inicio, fin, {
          inicio: turnoActivo.inicio,
          fin: turnoActivo.fin,
        });
        if (choque) {
          return { ...choque, texto: `No se pudo reprogramar: ese horario se ocupó recién. ${choque.texto}` };
        }

        await deps.calendarService.reprogramarEvento(agent.user, turnoActivo.googleEventId, { inicio, fin });
        const turno = await deps.prisma.turno.update({
          where: { id: turnoActivo.id },
          data: { inicio, fin },
        });

        const sinViejo = quitarOcupado(agenda, { inicio: turnoActivo.inicio, fin: turnoActivo.fin });
        return {
          texto: `Turno reprogramado para ${formatearFecha(inicio)}.`,
          agenda: agregarOcupado(sinViejo, { inicio, fin }),
          contexto: { ...contexto, turnoActivo: turno },
        };
      }

      case 'consultar_turno': {
        const turnos = await deps.prisma.turno.findMany({
          where: { conversationId: conversation.id, estado: 'confirmado' },
          orderBy: { inicio: 'asc' },
        });
        if (turnos.length === 0) {
          return { texto: 'No hay turnos agendados en esta conversación.' };
        }
        return {
          texto: turnos
            .map(
              (turno) =>
                `Turno el ${formatearFecha(turno.inicio)}${turno.nombreCliente ? ` a nombre de ${turno.nombreCliente}` : ''}.`,
            )
            .join(' '),
        };
      }

      case 'listar_eventos_calendario': {
        const desde = parsearFecha(args.desde, 'desde');
        const hasta = parsearFecha(args.hasta, 'hasta');
        const eventos = await deps.calendarService.listarProximos(agent.user, desde, hasta);
        if (eventos.length === 0) {
          return {
            texto: `No hay eventos en el calendario entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}.`,
          };
        }
        return {
          texto: eventos
            .map(
              (evento) =>
                `id=${evento.id} · ${evento.resumen || '(sin título)'} · ${evento.inicio ? formatearFecha(evento.inicio) : 'sin horario'}`,
            )
            .join('\n'),
        };
      }

      case 'cancelar_evento_calendario': {
        await deps.calendarService.eliminarEventoDesdeAgenda(
          agent.user,
          agent.userId,
          String(args.eventoId),
        );
        return { texto: 'Evento cancelado.' };
      }

      case 'editar_evento_calendario': {
        const inicio = parsearFechaOpcional(args.inicio, 'inicio');
        const fin = parsearFechaOpcional(args.fin, 'fin');
        const resumen = typeof args.resumen === 'string' ? args.resumen.trim() : undefined;

        await deps.calendarService.editarEventoDesdeAgenda(agent.user, agent.userId, String(args.eventoId), {
          ...(inicio ? { inicio } : {}),
          ...(fin ? { fin } : {}),
          ...(resumen ? { resumen } : {}),
        });
        return { texto: 'Evento actualizado.' };
      }

      default:
        return { texto: `La acción "${nombre}" no está habilitada para este agente.` };
    }
  }

  return async (state: EstadoConversacionValue): Promise<EstadoConversacionUpdate> => {
    let agenda = state.agenda;
    let contexto = state.contexto;
    const mensajes: ToolMessage[] = [];

    for (const operacion of state.pendientes) {
      let texto: string;
      try {
        const efecto = await ejecutar(agenda, contexto, operacion);
        texto = efecto.texto;
        if (efecto.agenda) agenda = efecto.agenda;
        if (efecto.contexto) contexto = efecto.contexto;
      } catch (error) {
        if (error instanceof CalendarUnavailableError) {
          logger.error(`Calendar no disponible en conversación ${contexto.conversation.id}`, error);
          texto = MENSAJE_CALENDAR_CAIDO;
        } else {
          logger.error(
            `Fallo ejecutando ${operacion.nombre} en conversación ${contexto.conversation.id}`,
            error as Error,
          );
          texto = `Error inesperado ejecutando "${operacion.nombre}": ${(error as Error).message}`;
        }
      }

      mensajes.push(
        new ToolMessage({ content: texto, tool_call_id: operacion.id, name: operacion.nombre }),
      );
    }

    return { messages: mensajes, pendientes: [], agenda, contexto };
  };
}

