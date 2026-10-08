import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { calendar_v3 } from 'googleapis';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CalendarioLocal } from './calendario-local.js';
import {
  CalendarUnavailableError,
  GoogleReconsentimientoError,
  getCalendarClient,
} from './google-calendar.client.js';
import { CAMPOS_OCUPADOS, ocupadosDeEventos } from './ocupados-google.js';

/** Zona horaria fija — el proyecto no soporta todavía timezone por usuario. */
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CALENDAR_ID = 'primary';

export type PeriodoOcupado = { inicio: Date; fin: Date };
export type DatosEvento = { resumen: string; inicio: Date; fin: Date };
export type EventoListado = { id: string; resumen: string; inicio: Date | null; fin: Date | null };
/** Un turno agendado por el agente, con lo que hace falta para mostrarlo y para editarlo en el calendario. */
export type TurnoAgendado = {
  id: string;
  googleEventId: string;
  nombreCliente: string | null;
  inicio: Date;
  fin: Date;
};

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

/**
 * Tope de páginas de `events.list` por consulta de ocupados. Con 2500 eventos
 * por página nunca debería pasar de una; el tope sólo evita un bucle infinito
 * si Google devolviera siempre un `nextPageToken`. Si se alcanza, falla en vez
 * de devolver ocupados a medias: una agenda incompleta ofrecería horarios
 * tomados.
 */
const MAX_PAGINAS_OCUPADOS = 20;

/**
 * Los ocupados de un calendario: `events.list` paginado sobre el rango, con
 * las instancias de los recurrentes expandidas. Si algún día se consultan
 * varios calendarios, es una llamada a esto por calendario en `Promise.all`.
 */
async function ocupadosDeCalendario(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  desde: Date,
  hasta: Date,
): Promise<PeriodoOcupado[]> {
  const eventos: calendar_v3.Schema$Event[] = [];
  let zona: string | null | undefined;
  let pageToken: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS_OCUPADOS; pagina++) {
    const res = await calendar.events.list({
      calendarId,
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      fields: CAMPOS_OCUPADOS,
      ...(pageToken ? { pageToken } : {}),
    });
    zona ??= res.data.timeZone;
    eventos.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) return ocupadosDeEventos(eventos, zona, TIMEZONE);
  }
  throw new CalendarUnavailableError('Google Calendar devolvió más páginas de eventos que las esperadas.');
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

  /**
   * Los períodos ocupados del titular en un rango. Conserva el nombre por
   * contrato con el grafo, pero ya no usa `freebusy.query`: eso pedía el scope
   * `calendar.freebusy`, que Google no tiene aprobado para esta app. Lee los
   * eventos con `events.list` (scope `calendar.events`) y decide en
   * `ocupadosDeEventos` cuáles bloquean, con los mismos criterios.
   */
  async freeBusy(user: UsuarioCalendario, desde: Date, hasta: Date): Promise<PeriodoOcupado[]> {
    if (this.usaCalendarioLocal(user)) return this.local.freeBusy(user.id, desde, hasta);

    const calendar = getCalendarClient(user, this.config);
    try {
      return await ocupadosDeCalendario(calendar, CALENDAR_ID, desde, hasta);
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

  /**
   * Los turnos que el agente agendó para este dueño en un rango, de todas sus
   * conversaciones. Con el nombre del cliente: es la única forma de saber a
   * nombre de quién quedó cada uno, porque el calendario sólo guarda el título.
   */
  async listarTurnos(userId: string, desde: Date, hasta: Date): Promise<TurnoAgendado[]> {
    return this.prisma.turno.findMany({
      where: {
        conversation: { userId },
        estado: 'confirmado',
        inicio: { lt: hasta },
        fin: { gt: desde },
      },
      select: { id: true, googleEventId: true, nombreCliente: true, inicio: true, fin: true },
      orderBy: { inicio: 'asc' },
    });
  }

  /** Ids de evento de Google que corresponden a turnos agendados por el agente (no cancelados). */
  async listarTurnosAgendados(userId: string, desde: Date, hasta: Date): Promise<Set<string>> {
    const turnos = await this.listarTurnos(userId, desde, hasta);
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
