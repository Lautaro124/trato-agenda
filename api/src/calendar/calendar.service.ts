import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CalendarioLocal } from './calendario-local.js';
import {
  CalendarUnavailableError,
  GoogleReconsentimientoError,
  getCalendarClient,
} from './google-calendar.client.js';

/** Zona horaria fija — el proyecto no soporta todavía timezone por usuario. */
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CALENDAR_ID = 'primary';

export type PeriodoOcupado = { inicio: Date; fin: Date };
export type DatosEvento = { resumen: string; inicio: Date; fin: Date };
export type EventoListado = { id: string; resumen: string; inicio: Date | null; fin: Date | null };

/** Lo que hace falta del usuario para decidir a qué calendario ir y autenticarse en Google. */
export type UsuarioCalendario = Pick<User, 'id' | 'calendario' | 'googleRefreshToken'>;

/** Valores de `User.calendario`. */
export const CALENDARIO_GOOGLE = 'google';
export const CALENDARIO_LOCAL = 'local';

export type ResultadoMigracion = { migrados: number; pendientes: number };

/**
 * Distingue "Google está caído" de "este usuario tiene que volver a consentir".
 * `googleapis` tira un GaxiosError: el 403 por scope insuficiente llega con
 * "Insufficient Permission" y el token revocado con `invalid_grant`.
 */
function necesitaReconsentimiento(error: unknown): boolean {
  const posible = error as { code?: number | string; status?: number; message?: unknown };
  const codigo = typeof posible?.code === 'number' ? posible.code : posible?.status;
  const mensaje = String(posible?.message ?? '');
  if (/invalid_grant/i.test(mensaje)) return true;
  return (codigo === 403 || codigo === 401) && /insufficient/i.test(mensaje);
}

function traducirError(error: unknown): CalendarUnavailableError {
  if (error instanceof CalendarUnavailableError) return error;
  if (necesitaReconsentimiento(error)) {
    return new GoogleReconsentimientoError(
      'El acceso a Google Calendar dejó de ser válido: hay que volver a entrar con Google.',
    );
  }
  return new CalendarUnavailableError(`Google Calendar no respondió: ${(error as Error).message}`);
}

/**
 * La agenda de un usuario: su Google Calendar ('primary') con el refresh token
 * guardado, o la agenda local en la base (`CalendarioLocal`) para las cuentas
 * con `calendario = "local"` — las creadas sólo con WhatsApp y las del login
 * de desarrollo. Los dos lados tienen el mismo contrato, así que el grafo y
 * los controllers no saben cuál están usando.
 *
 * Cualquier error de la API de Google (token revocado, red, etc.) se traduce a
 * CalendarUnavailableError para que quien llame (conversation.service.ts) no
 * tenga que conocer la forma de los errores de `googleapis`.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly local: CalendarioLocal;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.local = new CalendarioLocal(prisma);
  }

  private usaCalendarioLocal(user: UsuarioCalendario): boolean {
    return user.calendario === CALENDARIO_LOCAL;
  }

  async freeBusy(user: UsuarioCalendario, desde: Date, hasta: Date): Promise<PeriodoOcupado[]> {
    if (this.usaCalendarioLocal(user)) return this.local.freeBusy(user.id, desde, hasta);

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
    if (this.usaCalendarioLocal(user)) return this.local.crear(user.id, datos);

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
    if (this.usaCalendarioLocal(user)) return this.local.cancelar(user.id, googleEventId);

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
    if (this.usaCalendarioLocal(user)) return this.local.reprogramar(user.id, googleEventId, datos);

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
    if (this.usaCalendarioLocal(user)) return this.local.listar(user.id, desde, hasta);

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

  /**
   * Copia a Google los eventos de la agenda local que todavía no terminaron,
   * justo después de que el titular conecta Google Calendar. Evento por
   * evento: crea en Google, apunta el Turno al id nuevo y recién ahí borra la
   * fila local, así un corte a mitad de camino no duplica ni pierde nada — lo
   * migrado queda migrado y el resto sigue local para el próximo intento.
   * `user` tiene que tener ya el refresh token; `calendario` se ignora.
   */
  async migrarLocalAGoogle(user: UsuarioCalendario, ahora = new Date()): Promise<ResultadoMigracion> {
    const google: UsuarioCalendario = { ...user, calendario: CALENDARIO_GOOGLE };
    const eventos = await this.local.futuros(user.id, ahora);
    let migrados = 0;

    for (const evento of eventos) {
      if (!evento.inicio || !evento.fin) continue;
      try {
        const nuevoId = await this.crearEvento(google, {
          resumen: evento.resumen,
          inicio: evento.inicio,
          fin: evento.fin,
        });
        await this.prisma.turno.updateMany({
          where: { googleEventId: evento.id, conversation: { userId: user.id } },
          data: { googleEventId: nuevoId },
        });
        await this.local.cancelar(user.id, evento.id);
        migrados++;
      } catch (error) {
        this.logger.error(
          `No se pudo copiar a Google el evento ${evento.id} de ${user.id}: ${(error as Error).message}`,
        );
        return { migrados, pendientes: eventos.length - migrados };
      }
    }

    // Lo que ya terminó no aporta a la agenda: no se copia, se descarta.
    await this.prisma.evento.deleteMany({ where: { userId: user.id, fin: { lte: ahora } } });
    return { migrados, pendientes: 0 };
  }
}
