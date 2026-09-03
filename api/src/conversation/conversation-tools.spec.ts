import { describe, expect, it, vi } from 'vitest';
import type { CalendarService, PeriodoOcupado } from '../calendar/calendar.service.js';
import type { Agent, User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MARGEN_MINIMO_MIN, TOOLS, type ToolContext } from './conversation-tools.js';

const AGENT = {
  id: 'agent-1',
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreTitular: 'Tienda Centro',
  nombreBot: 'Tati',
} as unknown as Agent;

const USUARIO = { id: 'user-1', googleRefreshToken: 'cifrado' } as unknown as User;

/** Los tests trabajan en -03:00, la zona fija del proyecto. */
function hora(iso: string): string {
  return `2026-09-01T${iso}:00-03:00`;
}

function crearCtx(opciones: {
  ocupados?: PeriodoOcupado[];
  turnoActivo?: { id: string; googleEventId: string; inicio: Date; fin: Date } | null;
}) {
  const calendarService = {
    freeBusy: vi.fn().mockResolvedValue(opciones.ocupados ?? []),
    crearEvento: vi.fn().mockResolvedValue('evento-abc'),
    reprogramarEvento: vi.fn().mockResolvedValue(undefined),
  } as unknown as CalendarService;

  const prisma = {
    turno: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(opciones.turnoActivo ?? null),
    },
    conversation: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const ctx: ToolContext = {
    user: USUARIO,
    agent: AGENT,
    conversationId: 'conv-1',
    calendarService,
    prisma,
  };
  return { ctx, calendarService, prisma };
}

describe('crear_turno', () => {
  it('sin nombreCliente no toca el calendario y pide el nombre', async () => {
    const { ctx, calendarService, prisma } = crearCtx({});

    const resultado = await TOOLS.crear_turno.execute(ctx, {
      resumen: 'Corte',
      inicio: hora('10:00'),
      fin: hora('10:30'),
    });

    expect(resultado).toContain('nombre');
    expect(calendarService.freeBusy).not.toHaveBeenCalled();
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(prisma.turno.create).not.toHaveBeenCalled();
  });

  it('agenda con el nombre en el título y lo guarda en el turno y la conversación', async () => {
    const { ctx, calendarService, prisma } = crearCtx({});

    const resultado = await TOOLS.crear_turno.execute(ctx, {
      nombreCliente: 'Juan',
      resumen: 'Corte',
      inicio: hora('10:00'),
      fin: hora('10:30'),
    });

    expect(resultado).toContain('Juan');
    expect(calendarService.crearEvento).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ resumen: 'Corte - Juan' }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nombreCliente: 'Juan' }) }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1' }, data: { nombreCliente: 'Juan' } }),
    );
  });

  it('consulta disponibilidad ensanchando el rango con el margen mínimo', async () => {
    const { ctx, calendarService } = crearCtx({});

    await TOOLS.crear_turno.execute(ctx, {
      nombreCliente: 'Juan',
      resumen: 'Corte',
      inicio: hora('10:00'),
      fin: hora('10:30'),
    });

    const [, desde, hasta] = (calendarService.freeBusy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((desde as Date).toISOString()).toBe(new Date(hora('09:55')).toISOString());
    expect((hasta as Date).toISOString()).toBe(new Date(hora('10:35')).toISOString());
    expect(MARGEN_MINIMO_MIN).toBe(5);
  });

  it('rechaza un turno pegado a otro por el margen de 5 minutos', async () => {
    // Turno anterior de 09:30 a 10:00: a 3 minutos del nuevo, cae dentro del margen.
    const { ctx, calendarService } = crearCtx({
      ocupados: [{ inicio: new Date(hora('09:30')), fin: new Date(hora('10:00')) }],
    });

    const resultado = await TOOLS.crear_turno.execute(ctx, {
      nombreCliente: 'Juan',
      resumen: 'Corte',
      inicio: hora('10:03'),
      fin: hora('10:33'),
    });

    expect(resultado).toContain('No se pudo agendar');
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
  });

  it('rechaza un turno fuera de la franja de atención', async () => {
    const { ctx, calendarService } = crearCtx({});

    const resultado = await TOOLS.crear_turno.execute(ctx, {
      nombreCliente: 'Juan',
      resumen: 'Corte',
      inicio: hora('20:00'),
      fin: hora('20:30'),
    });

    expect(resultado).toContain('fuera de la franja');
    expect(calendarService.freeBusy).not.toHaveBeenCalled();
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
  });

  it('rechaza un rango invertido', async () => {
    const { ctx, calendarService } = crearCtx({});

    const resultado = await TOOLS.crear_turno.execute(ctx, {
      nombreCliente: 'Juan',
      resumen: 'Corte',
      inicio: hora('11:00'),
      fin: hora('10:00'),
    });

    expect(resultado).toContain('posterior al inicio');
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
  });
});

describe('reprogramar_turno', () => {
  const TURNO = {
    id: 'turno-1',
    googleEventId: 'evento-abc',
    inicio: new Date(hora('10:00')),
    fin: new Date(hora('10:30')),
  };

  it('no choca contra el propio evento del turno al moverlo unos minutos', async () => {
    // El único período ocupado es el turno mismo: con el margen, el rango nuevo
    // lo solapa, pero no tiene que contar como conflicto.
    const { ctx, calendarService, prisma } = crearCtx({
      ocupados: [{ inicio: TURNO.inicio, fin: TURNO.fin }],
      turnoActivo: TURNO,
    });

    const resultado = await TOOLS.reprogramar_turno.execute(ctx, {
      inicio: hora('10:10'),
      fin: hora('10:40'),
    });

    expect(resultado).toContain('reprogramado');
    expect(calendarService.reprogramarEvento).toHaveBeenCalled();
    expect(prisma.turno.update).toHaveBeenCalled();
  });

  it('sí choca contra un evento ajeno dentro del margen', async () => {
    const { ctx, calendarService } = crearCtx({
      ocupados: [
        { inicio: TURNO.inicio, fin: TURNO.fin },
        { inicio: new Date(hora('10:42')), fin: new Date(hora('11:00')) },
      ],
      turnoActivo: TURNO,
    });

    const resultado = await TOOLS.reprogramar_turno.execute(ctx, {
      inicio: hora('10:10'),
      fin: hora('10:40'),
    });

    expect(resultado).toContain('No se pudo reprogramar');
    expect(calendarService.reprogramarEvento).not.toHaveBeenCalled();
  });

  it('rechaza mover el turno fuera de la franja', async () => {
    const { ctx, calendarService } = crearCtx({ turnoActivo: TURNO });

    const resultado = await TOOLS.reprogramar_turno.execute(ctx, {
      inicio: hora('08:00'),
      fin: hora('08:30'),
    });

    expect(resultado).toContain('fuera de la franja');
    expect(calendarService.reprogramarEvento).not.toHaveBeenCalled();
  });
});
