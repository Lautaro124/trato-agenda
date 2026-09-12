import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { esGoogleIdDev } from '../auth/usuario-dev.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CalendarioDev } from './calendario-dev.js';
import { CalendarUnavailableError, getCalendarClient } from './google-calendar.client.js';

/** Zona horaria fija — el proyecto no soporta todavía timezone por usuario. */
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CALENDAR_ID = 'primary';

export type PeriodoOcupado = { inicio: Date; fin: Date };
export type DatosEvento = { resumen: string; inicio: Date; fin: Date };
export type EventoListado = { id: string; resumen: string; inicio: Date | null; fin: Date | null };

/** Lo que hace falta del usuario para decidir a qué calendario ir y autenticarse en Google. */
export type UsuarioCalendario = Pick<User, 'id' | 'googleId' | 'googleRefreshToken'>;

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
 *
 * Los usuarios del login de desarrollo no tienen Google: fuera de producción
 * van a un `CalendarioDev` en memoria con el mismo contrato.
 */
@Injectable()
export class CalendarService {
  private readonly calendarioDev = new CalendarioDev();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  /** En producción nunca: un googleId "dev:" ahí sólo podría venir de datos manipulados. */
  private usaCalendarioDev(user: UsuarioCalendario): boolean {
    return this.config.get('NODE_ENV', { infer: true }) !== 'production' && esGoogleIdDev(user.googleId);
  }

  async freeBusy(user: UsuarioCalendario, desde: Date, hasta: Date): Promise<PeriodoOcupado[]> {
    if (this.usaCalendarioDev(user)) return this.calendarioDev.freeBusy(user.id, desde, hasta);

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

  async crearEvento(user: UsuarioCalendario, datos: DatosEvento): Promise<string> {
    if (this.usaCalendarioDev(user)) return this.calendarioDev.crear(user.id, datos);

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

  async cancelarEvento(user: UsuarioCalendario, googleEventId: string): Promise<void> {
    if (this.usaCalendarioDev(user)) {
      this.calendarioDev.cancelar(user.id, googleEventId);
      return;
    }

    const calendar = getCalendarClient(user, this.config);
    try {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async reprogramarEvento(
    user: UsuarioCalendario,
    googleEventId: string,
    datos: Partial<Pick<DatosEvento, 'resumen' | 'inicio' | 'fin'>>,
  ): Promise<void> {
    if (this.usaCalendarioDev(user)) {
      this.calendarioDev.reprogramar(user.id, googleEventId, datos);
      return;
    }

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
    user: UsuarioCalendario,
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
    user: UsuarioCalendario,
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

  async listarProximos(user: UsuarioCalendario, desde: Date, hasta: Date): Promise<EventoListado[]> {
    if (this.usaCalendarioDev(user)) return this.calendarioDev.listar(user.id, desde, hasta);

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
