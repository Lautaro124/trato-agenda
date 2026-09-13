import { AIMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarUnavailableError } from '../../../calendar/google-calendar.client.js';
import { dentroDeFranja, esDiaHabil, horaLocal } from '../agenda-rules.js';
import { AGENT, correr, crearCalendar, crearModelo, crearPrisma, hora, llamada } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('límites de fecha y franja (matriz B)', () => {
  it('B-004: cancelar sin turno activo no toca Google', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([llamada('cancelar_turno', {}), new AIMessage('No hay turno.')]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.cancelarEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('No hay ningún turno activo para cancelar');
  });

  it('B-006: un turno que cruza la medianoche se rechaza como fuera de franja', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('23:50'),
        fin: hora('00:20', '2026-09-02'),
      }),
      new AIMessage('Ese horario no.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('fuera de la franja');
  });

  it('B-008: 2028-02-29 (año bisiesto, martes) se trata como día hábil normal', () => {
    expect(esDiaHabil('2028-02-29')).toBe(true);
    expect(new Date('2028-02-29T12:00:00-03:00').getUTCDay()).toBe(2);
  });

  it('B-010: offset explícito +05:00 se respeta tal cual (no se corrige a la zona del negocio)', () => {
    // 14:00 +05:00 son las 06:00 en -03:00.
    expect(horaLocal(new Date('2026-09-08T14:00:00+05:00'))).toBe('06:00');
  });

  it('B-012: fecha en el pasado se rechaza por fuera de la ventana', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('10:00', '2026-08-25'),
        fin: hora('10:30', '2026-08-25'),
      }),
      new AIMessage('Esa fecha ya pasó.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('fuera de los próximos días');
  });

  it('B-013: el último día hábil íntegramente cubierto por la ventana (14 días) se acepta', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    // Reloj en 08:00 del 2026-09-01: la ventana llega hasta el 2026-09-15 08:00,
    // así que el 2026-09-14 es el último día cuya franja completa (09:00-18:00)
    // entra entera dentro de la ventana cargada.
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('09:00', '2026-09-14'),
        fin: hora('09:30', '2026-09-14'),
      }),
      new AIMessage('Listo.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).toHaveBeenCalled();
  });

  it('B-014: un día después de la ventana (15 días) se rechaza sin tocar Google', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('09:00', '2026-09-16'),
        fin: hora('09:30', '2026-09-16'),
      }),
      new AIMessage('Muy lejos.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
  });

  it('B-016/B-017: el inicio exacto de la franja entra, un minuto después del cierre no', () => {
    expect(dentroDeFranja(AGENT, new Date(hora('09:00')), new Date(hora('09:30')))).toBe(true);
    expect(dentroDeFranja(AGENT, new Date(hora('17:30')), new Date(hora('18:00')))).toBe(true);
    expect(dentroDeFranja(AGENT, new Date(hora('17:45')), new Date(hora('18:15')))).toBe(false);
  });

  it('B-020: un turno a exactamente 5 minutos de otro se acepta (margen mínimo, no violación)', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar([{ inicio: new Date(hora('09:30')), fin: new Date(hora('10:00')) }]);
    // La relectura de último momento (choqueDeUltimoMomento) sólo pide el rango
    // angosto del nuevo turno: a diferencia del snapshot, ahí no debe reportar
    // el turno de las 09:30, que ya quedó fuera de margen.
    (calendarService.freeBusy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { inicio: new Date(hora('09:30')), fin: new Date(hora('10:00')) },
    ]).mockResolvedValue([]);
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:05'), fin: hora('10:35') }),
      new AIMessage('Listo.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).toHaveBeenCalled();
  });

  it('B-021: un turno a 6 minutos de otro se acepta sin ambigüedad', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    (calendarService.freeBusy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { inicio: new Date(hora('09:30')), fin: new Date(hora('10:00')) },
    ]).mockResolvedValue([]);
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:06'), fin: hora('10:36') }),
      new AIMessage('Listo.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).toHaveBeenCalled();
  });

  it('B-027: el nombre corregido a mitad de charla es el que queda en el Turno', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan Pérez', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Listo Juan Pérez.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nombreCliente: 'Juan Pérez' }) }),
    );
  });

  it('B-028: confirmar un horario que ya no entra en la ventana actual se revalida, no se agenda a ciegas', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('09:00', '2026-09-20'),
        fin: hora('09:30', '2026-09-20'),
      }),
      new AIMessage('Esa fecha ya no la tengo.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
  });

  it('B-030: un mensaje vacío no rompe el grafo', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([new AIMessage('¿En qué te puedo ayudar?')]);

    const resultado = await correr({ prisma, calendarService, llm }, { mensaje: '' });

    expect(resultado.messages.at(-1)?.content).toBeTruthy();
  });

  it('F-008: Calendar caído durante la escritura da un mensaje seguro, no el error interno', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    (calendarService.crearEvento as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CalendarUnavailableError('detalle interno sensible'),
    );
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Perdón, hay un problema.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).not.toContain('detalle interno sensible');
  });
});
