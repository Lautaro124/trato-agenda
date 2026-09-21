import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptToken } from '../auth/token-crypto.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { prismaConEventosEnMemoria } from './eventos-en-memoria.fake.js';

const { freebusyQuery, eventsInsert, eventsDelete, eventsPatch, eventsList, oauth2SetCredentials } =
  vi.hoisted(() => ({
    freebusyQuery: vi.fn(),
    eventsInsert: vi.fn(),
    eventsDelete: vi.fn(),
    eventsPatch: vi.fn(),
    eventsList: vi.fn(),
    oauth2SetCredentials: vi.fn(),
  }));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function OAuth2() {
        return { setCredentials: oauth2SetCredentials };
      }),
    },
    calendar: vi.fn(() => ({
      freebusy: { query: freebusyQuery },
      events: { insert: eventsInsert, delete: eventsDelete, patch: eventsPatch, list: eventsList },
    })),
  },
}));

const { CalendarService } = await import('./calendar.service.js');
const { CalendarUnavailableError } = await import('./google-calendar.client.js');

const CLAVE = randomBytes(32).toString('hex');

function crearConfig(nodeEnv: Env['NODE_ENV'] = 'development'): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    NODE_ENV: nodeEnv,
    TOKEN_ENCRYPTION_KEY: CLAVE,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

type UsuarioDePrueba = Pick<User, 'id' | 'calendario' | 'googleRefreshToken'>;

function usuarioConToken(): UsuarioDePrueba {
  return { id: 'user-1', calendario: 'google', googleRefreshToken: encryptToken('1//refresh-de-prueba', CLAVE) };
}

/** Cuenta sin Google (alta por WhatsApp o login de desarrollo): agenda en la base. */
const USUARIO_LOCAL: UsuarioDePrueba = {
  id: 'user-local',
  calendario: 'local',
  googleRefreshToken: null,
};

/** Prisma con `turno.updateMany` espiado y `evento` en memoria. */
function crearPrisma(turnos: unknown[] = []): PrismaService {
  const { prisma } = prismaConEventosEnMemoria();
  return Object.assign(prisma, {
    turno: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue(turnos),
    },
  }) as unknown as PrismaService;
}

describe('CalendarService', () => {
  beforeEach(() => {
    freebusyQuery.mockReset();
    eventsInsert.mockReset();
    eventsDelete.mockReset();
    eventsPatch.mockReset();
    eventsList.mockReset();
  });

  it('tira CalendarUnavailableError si el usuario no tiene refresh token', async () => {
    const service = new CalendarService(crearConfig(), crearPrisma());

    await expect(
      service.freeBusy({ id: 'user-1', calendario: 'google', googleRefreshToken: null }, new Date(), new Date()),
    ).rejects.toThrow(CalendarUnavailableError);
    expect(freebusyQuery).not.toHaveBeenCalled();
  });

  describe('usuario con agenda local', () => {
    const inicio = new Date('2026-09-14T10:00:00-03:00');
    const fin = new Date('2026-09-14T10:30:00-03:00');
    const dia: [Date, Date] = [new Date('2026-09-14T00:00:00-03:00'), new Date('2026-09-15T00:00:00-03:00')];

    it('crea, lista, reprograma y cancela en la base sin tocar Google', async () => {
      const service = new CalendarService(crearConfig(), crearPrisma());

      const id = await service.crearEvento(USUARIO_LOCAL, { resumen: 'Control - Caro', inicio, fin });
      expect(await service.freeBusy(USUARIO_LOCAL, ...dia)).toEqual([{ inicio, fin }]);

      const nuevoInicio = new Date('2026-09-14T11:00:00-03:00');
      const nuevoFin = new Date('2026-09-14T11:30:00-03:00');
      await service.reprogramarEvento(USUARIO_LOCAL, id, { inicio: nuevoInicio, fin: nuevoFin });
      expect(await service.listarProximos(USUARIO_LOCAL, ...dia)).toEqual([
        { id, resumen: 'Control - Caro', inicio: nuevoInicio, fin: nuevoFin },
      ]);

      await service.cancelarEvento(USUARIO_LOCAL, id);
      expect(await service.listarProximos(USUARIO_LOCAL, ...dia)).toEqual([]);

      expect(freebusyQuery).not.toHaveBeenCalled();
      expect(eventsInsert).not.toHaveBeenCalled();
      expect(eventsPatch).not.toHaveBeenCalled();
      expect(eventsDelete).not.toHaveBeenCalled();
      expect(eventsList).not.toHaveBeenCalled();
    });

    it('eliminarEventoDesdeAgenda también marca cancelado el Turno del usuario local', async () => {
      const prisma = crearPrisma();
      const service = new CalendarService(crearConfig(), prisma);
      const id = await service.crearEvento(USUARIO_LOCAL, { resumen: 'Control', inicio, fin });

      await service.eliminarEventoDesdeAgenda(USUARIO_LOCAL, USUARIO_LOCAL.id, id);

      expect(prisma.turno.updateMany).toHaveBeenCalledWith({
        where: { googleEventId: id, conversation: { userId: 'user-local' }, estado: 'confirmado' },
        data: { estado: 'cancelado' },
      });
    });

    it('una cuenta de Google sin token no cae en la agenda local: falla', async () => {
      const service = new CalendarService(crearConfig('production'), crearPrisma());
      const sinToken: UsuarioDePrueba = { ...USUARIO_LOCAL, calendario: 'google' };

      await expect(service.freeBusy(sinToken, ...dia)).rejects.toThrow(CalendarUnavailableError);
      await expect(service.crearEvento(sinToken, { resumen: 'x', inicio, fin })).rejects.toThrow(
        CalendarUnavailableError,
      );
    });

    it('funciona igual en producción', async () => {
      const service = new CalendarService(crearConfig('production'), crearPrisma());

      const id = await service.crearEvento(USUARIO_LOCAL, { resumen: 'Control', inicio, fin });

      expect(await service.listarProximos(USUARIO_LOCAL, ...dia)).toEqual([{ id, resumen: 'Control', inicio, fin }]);
      expect(eventsInsert).not.toHaveBeenCalled();
    });
  });

  it('freeBusy mapea los períodos ocupados de la respuesta', async () => {
    freebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [{ start: '2026-09-01T10:00:00Z', end: '2026-09-01T11:00:00Z' }] },
        },
      },
    });
    const service = new CalendarService(crearConfig(), crearPrisma());

    const ocupados = await service.freeBusy(usuarioConToken(), new Date(), new Date());

    expect(ocupados).toEqual([
      { inicio: new Date('2026-09-01T10:00:00Z'), fin: new Date('2026-09-01T11:00:00Z') },
    ]);
  });

  it('crearEvento devuelve el id del evento creado', async () => {
    eventsInsert.mockResolvedValue({ data: { id: 'evento-123' } });
    const service = new CalendarService(crearConfig(), crearPrisma());

    const id = await service.crearEvento(usuarioConToken(), {
      resumen: 'Corte de pelo',
      inicio: new Date('2026-09-01T10:00:00Z'),
      fin: new Date('2026-09-01T10:30:00Z'),
    });

    expect(id).toBe('evento-123');
    expect(eventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'primary', requestBody: expect.objectContaining({ summary: 'Corte de pelo' }) }),
    );
  });

  it('crearEvento traduce un error de la API a CalendarUnavailableError', async () => {
    eventsInsert.mockRejectedValue(new Error('403 forbidden'));
    const service = new CalendarService(crearConfig(), crearPrisma());

    await expect(
      service.crearEvento(usuarioConToken(), {
        resumen: 'x',
        inicio: new Date(),
        fin: new Date(),
      }),
    ).rejects.toThrow(CalendarUnavailableError);
  });

  it('cancelarEvento llama a events.delete con el eventId', async () => {
    eventsDelete.mockResolvedValue({});
    const service = new CalendarService(crearConfig(), crearPrisma());

    await service.cancelarEvento(usuarioConToken(), 'evento-123');

    expect(eventsDelete).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'evento-123' });
  });

  it('reprogramarEvento llama a events.patch con el nuevo horario', async () => {
    eventsPatch.mockResolvedValue({});
    const service = new CalendarService(crearConfig(), crearPrisma());
    const inicio = new Date('2026-09-02T10:00:00Z');
    const fin = new Date('2026-09-02T10:30:00Z');

    await service.reprogramarEvento(usuarioConToken(), 'evento-123', { inicio, fin });

    expect(eventsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        eventId: 'evento-123',
        requestBody: expect.objectContaining({
          start: { dateTime: inicio.toISOString(), timeZone: 'America/Argentina/Buenos_Aires' },
        }),
      }),
    );
  });

  it('eliminarEventoDesdeAgenda borra el evento y marca cancelado el Turno si existe', async () => {
    eventsDelete.mockResolvedValue({});
    const prisma = crearPrisma();
    const service = new CalendarService(crearConfig(), prisma);

    await service.eliminarEventoDesdeAgenda(usuarioConToken(), 'user-1', 'evento-123');

    expect(eventsDelete).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'evento-123' });
    expect(prisma.turno.updateMany).toHaveBeenCalledWith({
      where: { googleEventId: 'evento-123', conversation: { userId: 'user-1' }, estado: 'confirmado' },
      data: { estado: 'cancelado' },
    });
  });

  it('editarEventoDesdeAgenda patchea el evento y actualiza el Turno cuando cambia inicio/fin', async () => {
    eventsPatch.mockResolvedValue({});
    const prisma = crearPrisma();
    const service = new CalendarService(crearConfig(), prisma);
    const inicio = new Date('2026-09-03T10:00:00Z');
    const fin = new Date('2026-09-03T10:30:00Z');

    await service.editarEventoDesdeAgenda(usuarioConToken(), 'user-1', 'evento-123', { inicio, fin, resumen: 'Nuevo título' });

    expect(eventsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        eventId: 'evento-123',
        requestBody: expect.objectContaining({ summary: 'Nuevo título' }),
      }),
    );
    expect(prisma.turno.updateMany).toHaveBeenCalledWith({
      where: { googleEventId: 'evento-123', conversation: { userId: 'user-1' } },
      data: { inicio, fin },
    });
  });

  it('editarEventoDesdeAgenda no toca el Turno si sólo cambia el título', async () => {
    eventsPatch.mockResolvedValue({});
    const prisma = crearPrisma();
    const service = new CalendarService(crearConfig(), prisma);

    await service.editarEventoDesdeAgenda(usuarioConToken(), 'user-1', 'evento-123', { resumen: 'Sólo título' });

    expect(prisma.turno.updateMany).not.toHaveBeenCalled();
  });

  it('listarProximos mapea los eventos con start/end dateTime', async () => {
    eventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evento-123',
            summary: 'Corte de pelo',
            start: { dateTime: '2026-09-01T10:00:00Z' },
            end: { dateTime: '2026-09-01T10:30:00Z' },
          },
        ],
      },
    });
    const service = new CalendarService(crearConfig(), crearPrisma());

    const eventos = await service.listarProximos(usuarioConToken(), new Date(), new Date());

    expect(eventos).toEqual([
      {
        id: 'evento-123',
        resumen: 'Corte de pelo',
        inicio: new Date('2026-09-01T10:00:00Z'),
        fin: new Date('2026-09-01T10:30:00Z'),
      },
    ]);
  });

  describe('migrarLocalAGoogle', () => {
    const ahora = new Date('2026-09-14T12:00:00-03:00');
    const h = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00-03:00`);

    function conToken(): UsuarioDePrueba {
      return { ...usuarioConToken(), id: USUARIO_LOCAL.id, calendario: 'local' };
    }

    it('copia los eventos futuros a Google, re-apunta los Turnos y vacía la agenda local', async () => {
      const prisma = crearPrisma();
      const service = new CalendarService(crearConfig(), prisma);
      await service.crearEvento(USUARIO_LOCAL, { resumen: 'Pasado', inicio: h('09:00'), fin: h('10:00') });
      const futuro = await service.crearEvento(USUARIO_LOCAL, { resumen: 'Control', inicio: h('15:00'), fin: h('15:30') });
      eventsInsert.mockResolvedValue({ data: { id: 'google-1' } });

      const resultado = await service.migrarLocalAGoogle(conToken(), ahora);

      expect(resultado).toEqual({ migrados: 1, pendientes: 0 });
      expect(eventsInsert).toHaveBeenCalledTimes(1);
      expect(eventsInsert.mock.calls[0][0].requestBody.summary).toBe('Control');
      expect(prisma.turno.updateMany).toHaveBeenCalledWith({
        where: { googleEventId: futuro, conversation: { userId: 'user-local' } },
        data: { googleEventId: 'google-1' },
      });
      expect(await service.listarProximos(USUARIO_LOCAL, h('00:00'), h('23:59'))).toEqual([]);
    });

    it('si Google falla a mitad, lo copiado queda copiado y el resto sigue local', async () => {
      const prisma = crearPrisma();
      const service = new CalendarService(crearConfig(), prisma);
      await service.crearEvento(USUARIO_LOCAL, { resumen: 'A', inicio: h('14:00'), fin: h('14:30') });
      const b = await service.crearEvento(USUARIO_LOCAL, { resumen: 'B', inicio: h('16:00'), fin: h('16:30') });
      eventsInsert.mockResolvedValueOnce({ data: { id: 'google-a' } }).mockRejectedValueOnce(new Error('503'));

      const resultado = await service.migrarLocalAGoogle(conToken(), ahora);

      expect(resultado).toEqual({ migrados: 1, pendientes: 1 });
      const quedan = await service.listarProximos(USUARIO_LOCAL, h('00:00'), h('23:59'));
      expect(quedan.map((evento) => evento.id)).toEqual([b]);
    });
  });

  describe('turnos agendados por el agente', () => {
    const TURNOS = [
      { id: 't1', googleEventId: 'evento-a', nombreCliente: 'Juana', inicio: new Date(), fin: new Date() },
      { id: 't2', googleEventId: 'evento-b', nombreCliente: null, inicio: new Date(), fin: new Date() },
    ];

    it('listarTurnos devuelve las filas con el nombre del cliente, ordenadas por inicio', async () => {
      const prisma = crearPrisma(TURNOS);
      const service = new CalendarService(crearConfig(), prisma);

      const turnos = await service.listarTurnos('user-1', new Date(), new Date());

      expect(turnos).toEqual(TURNOS);
      expect(prisma.turno.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { inicio: 'asc' } }),
      );
    });

    it('listarTurnosAgendados sigue devolviendo sólo el set de ids de evento', async () => {
      const service = new CalendarService(crearConfig(), crearPrisma(TURNOS));

      const ids = await service.listarTurnosAgendados('user-1', new Date(), new Date());

      expect(ids).toEqual(new Set(['evento-a', 'evento-b']));
    });
  });
});
