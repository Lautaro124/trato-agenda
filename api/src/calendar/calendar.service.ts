import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CalendarUnavailableError, getCalendarClient } from './google-calendar.client.js';

/** Zona horaria fija — el proyecto no soporta todavía timezone por usuario. */
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CALENDAR_ID = 'primary';

export type PeriodoOcupado = { inicio: Date; fin: Date };
export type DatosEvento = { resumen: string; inicio: Date; fin: Date };
export type EventoListado = { id: string; resumen: string; inicio: Date | null; fin: Date | null };

function traducirError(error: unknown): CalendarUnavailableError {
  if (error instanceof CalendarUnavailableError) return error;
  return new CalendarUnavailableError(`Google Calendar no respondió: ${(error as Error).message}`);
}

/**
 * Operaciones reales sobre el Google Calendar ('primary') de un usuario,
 * usando su refresh token guardado. Cualquier error de la API de Google
 * (token revocado, red, etc.) se traduce a CalendarUnavailableError para que
 * quien llame (conversation.service.ts) no tenga que conocer la forma de
 * los errores de `googleapis`.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async freeBusy(
    user: Pick<User, 'googleRefreshToken'>,
    desde: Date,
    hasta: Date,
  ): Promise<PeriodoOcupado[]> {
    const calendar = getCalendarClient(user, this.config);
    try {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: desde.toISOString(),
          timeMax: hasta.toISOString(),
          items: [{ id: CALENDAR_ID }],
        },
      });
      const ocupado = res.data.calendars?.[CALENDAR_ID]?.busy ?? [];
      return ocupado
        .filter((periodo) => periodo.start && periodo.end)
        .map((periodo) => ({ inicio: new Date(periodo.start!), fin: new Date(periodo.end!) }));
    } catch (error) {
      throw traducirError(error);
    }
  }

  async crearEvento(user: Pick<User, 'googleRefreshToken'>, datos: DatosEvento): Promise<string> {
    const calendar = getCalendarClient(user, this.config);
    try {
      const res = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: datos.resumen,
          start: { dateTime: datos.inicio.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: datos.fin.toISOString(), timeZone: TIMEZONE },
        },
      });
      if (!res.data.id) {
        throw new CalendarUnavailableError('Google Calendar no devolvió un id de evento.');
      }
      return res.data.id;
    } catch (error) {
      throw traducirError(error);
    }
  }

  async cancelarEvento(
    user: Pick<User, 'googleRefreshToken'>,
    googleEventId: string,
  ): Promise<void> {
    const calendar = getCalendarClient(user, this.config);
    try {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async reprogramarEvento(
    user: Pick<User, 'googleRefreshToken'>,
    googleEventId: string,
    datos: Partial<Pick<DatosEvento, 'resumen' | 'inicio' | 'fin'>>,
  ): Promise<void> {
    const calendar = getCalendarClient(user, this.config);
    try {
      await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: googleEventId,
        requestBody: {
          ...(datos.resumen !== undefined ? { summary: datos.resumen } : {}),
          ...(datos.inicio ? { start: { dateTime: datos.inicio.toISOString(), timeZone: TIMEZONE } } : {}),
          ...(datos.fin ? { end: { dateTime: datos.fin.toISOString(), timeZone: TIMEZONE } } : {}),
        },
      });
    } catch (error) {
      throw traducirError(error);
    }
  }

  /**
   * Elimina un evento desde la vista web del calendario (a diferencia de
   * `cancelarEvento`, que usa el agente para el turno vigente de una
   * conversación puntual). Si el evento corresponde a un Turno agendado por
   * el agente, lo marca cancelado para no desincronizar el tracking.
   */
  async eliminarEventoDesdeAgenda(
    user: Pick<User, 'googleRefreshToken'>,
    userId: string,
    googleEventId: string,
  ): Promise<void> {
    await this.cancelarEvento(user, googleEventId);
    await this.prisma.turno.updateMany({
      where: { googleEventId, conversation: { userId }, estado: 'confirmado' },
      data: { estado: 'cancelado' },
    });
  }

  /** Análogo a eliminarEventoDesdeAgenda pero para editar horario y/o título. */
  async editarEventoDesdeAgenda(
    user: Pick<User, 'googleRefreshToken'>,
    userId: string,
    googleEventId: string,
    datos: Partial<Pick<DatosEvento, 'resumen' | 'inicio' | 'fin'>>,
  ): Promise<void> {
    await this.reprogramarEvento(user, googleEventId, datos);
    if (datos.inicio && datos.fin) {
      await this.prisma.turno.updateMany({
        where: { googleEventId, conversation: { userId } },
        data: { inicio: datos.inicio, fin: datos.fin },
      });
    }
  }

  async listarProximos(
    user: Pick<User, 'googleRefreshToken'>,
    desde: Date,
    hasta: Date,
  ): Promise<EventoListado[]> {
    const calendar = getCalendarClient(user, this.config);
    try {
      const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items ?? []).map((evento) => ({
        id: evento.id ?? '',
        resumen: evento.summary ?? '',
        inicio: evento.start?.dateTime ? new Date(evento.start.dateTime) : null,
        fin: evento.end?.dateTime ? new Date(evento.end.dateTime) : null,
      }));
    } catch (error) {
      throw traducirError(error);
    }
  }

  /** Ids de evento de Google que corresponden a turnos agendados por el agente (no cancelados). */
  async listarTurnosAgendados(userId: string, desde: Date, hasta: Date): Promise<Set<string>> {
    const turnos = await this.prisma.turno.findMany({
      where: {
        conversation: { userId },
        estado: 'confirmado',
        inicio: { lt: hasta },
        fin: { gt: desde },
      },
      select: { googleEventId: true },
    });
    return new Set(turnos.map((turno) => turno.googleEventId));
  }
}
