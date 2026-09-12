import { describe, expect, it } from 'vitest';
import { CalendarioDev } from './calendario-dev.js';
import { CalendarUnavailableError } from './google-calendar.client.js';

function hora(hhmm: string, dia = '2026-09-14'): Date {
  return new Date(`${dia}T${hhmm}:00-03:00`);
}

const DIA_COMPLETO: [Date, Date] = [hora('00:00'), hora('23:59')];

describe('CalendarioDev', () => {
  it('un evento creado aparece en freeBusy y en listar', () => {
    const calendario = new CalendarioDev();

    const id = calendario.crear('user-1', { resumen: 'Control - Caro', inicio: hora('10:00'), fin: hora('10:30') });

    expect(id).toMatch(/^dev-evento-/);
    expect(calendario.freeBusy('user-1', ...DIA_COMPLETO)).toEqual([{ inicio: hora('10:00'), fin: hora('10:30') }]);
    expect(calendario.listar('user-1', ...DIA_COMPLETO)).toEqual([
      { id, resumen: 'Control - Caro', inicio: hora('10:00'), fin: hora('10:30') },
    ]);
  });

  it('sólo devuelve lo que se superpone con el rango pedido, ordenado por inicio', () => {
    const calendario = new CalendarioDev();
    calendario.crear('user-1', { resumen: 'B', inicio: hora('15:00'), fin: hora('16:00') });
    calendario.crear('user-1', { resumen: 'A', inicio: hora('09:00'), fin: hora('10:00') });
    calendario.crear('user-1', { resumen: 'Otro día', inicio: hora('09:00', '2026-09-15'), fin: hora('10:00', '2026-09-15') });

    const eventos = calendario.listar('user-1', hora('09:30'), hora('15:30'));

    expect(eventos.map((evento) => evento.resumen)).toEqual(['A', 'B']);
  });

  it('reprogramar mueve el evento y libera el horario viejo', () => {
    const calendario = new CalendarioDev();
    const id = calendario.crear('user-1', { resumen: 'Control', inicio: hora('10:00'), fin: hora('10:30') });

    calendario.reprogramar('user-1', id, { inicio: hora('11:00'), fin: hora('11:30') });

    expect(calendario.freeBusy('user-1', hora('10:00'), hora('10:30'))).toEqual([]);
    expect(calendario.listar('user-1', ...DIA_COMPLETO)).toEqual([
      { id, resumen: 'Control', inicio: hora('11:00'), fin: hora('11:30') },
    ]);
  });

  it('cancelar borra el evento', () => {
    const calendario = new CalendarioDev();
    const id = calendario.crear('user-1', { resumen: 'Control', inicio: hora('10:00'), fin: hora('10:30') });

    calendario.cancelar('user-1', id);

    expect(calendario.listar('user-1', ...DIA_COMPLETO)).toEqual([]);
  });

  it('cancelar o reprogramar un evento inexistente tira CalendarUnavailableError, como Google', () => {
    const calendario = new CalendarioDev();

    expect(() => calendario.cancelar('user-1', 'no-existe')).toThrow(CalendarUnavailableError);
    expect(() => calendario.reprogramar('user-1', 'no-existe', { resumen: 'x' })).toThrow(CalendarUnavailableError);
  });

  it('los calendarios de distintos usuarios no se mezclan', () => {
    const calendario = new CalendarioDev();
    const id = calendario.crear('user-1', { resumen: 'Control', inicio: hora('10:00'), fin: hora('10:30') });

    expect(calendario.listar('user-2', ...DIA_COMPLETO)).toEqual([]);
    expect(() => calendario.cancelar('user-2', id)).toThrow(CalendarUnavailableError);
  });
});
