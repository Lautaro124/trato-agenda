import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptToken } from '../auth/token-crypto.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

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

function crearConfig(): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    TOKEN_ENCRYPTION_KEY: CLAVE,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

function usuarioConToken(): Pick<User, 'googleRefreshToken'> {
  return { googleRefreshToken: encryptToken('1//refresh-de-prueba', CLAVE) };
}

function crearPrisma(): PrismaService {
  return { turno: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as unknown as PrismaService;
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
      service.freeBusy({ googleRefreshToken: null }, new Date(), new Date()),
    ).rejects.toThrow(CalendarUnavailableError);
    expect(freebusyQuery).not.toHaveBeenCalled();
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
});
