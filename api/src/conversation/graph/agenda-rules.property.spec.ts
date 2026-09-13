/**
 * Property-based testing (fast-check) sobre las funciones puras de
 * agenda-rules.ts: fechas, intervalos y huecos. Semilla fija para
 * reproducibilidad; `numRuns` acotado para que la corrida siga siendo rápida
 * y gratis (no golpea red, no depende de OpenRouter).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PeriodoOcupado } from '../../calendar/calendar.service.js';
import { MARGEN_MINIMO_MIN, conMargen, esDiaHabil, fechaEnDia, huecosDelDia, parsearFecha } from './agenda-rules.js';

const SEMILLA = { seed: 42, numRuns: 200 };

/** "2026-01-01".."2029-12-31", como string de día — rango amplio a propósito, incluye bisiestos. */
const arbDia = fc
  .integer({ min: 0, max: 365 * 4 })
  .map((offset) => {
    const base = new Date('2026-01-01T00:00:00-03:00');
    base.setUTCDate(base.getUTCDate() + offset);
    return base.toISOString().slice(0, 10);
  });

const arbHora = fc.integer({ min: 0, max: 23 * 60 + 59 }).map((minutos) => {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
});

const AGENT_FRANJA = { horaDesde: '09:00', horaHasta: '18:00' };

describe('agenda-rules.ts — propiedades (fast-check, seed 42)', () => {
  it('esDiaHabil coincide siempre con getUTCDay() de las 12:00 de ese día', () => {
    fc.assert(
      fc.property(arbDia, (dia) => {
        const esperado = [1, 2, 3, 4, 5].includes(fechaEnDia(dia, '12:00').getUTCDay());
        expect(esDiaHabil(dia)).toBe(esperado);
      }),
      SEMILLA,
    );
  });

  it('conMargen siempre ensancha simétricamente por MARGEN_MINIMO_MIN de cada lado', () => {
    fc.assert(
      fc.property(arbDia, arbHora, fc.integer({ min: 1, max: 12 * 60 }), (dia, horaInicio, duracionMin) => {
        const inicio = fechaEnDia(dia, horaInicio);
        const fin = new Date(inicio.getTime() + duracionMin * 60_000);
        const [desde, hasta] = conMargen(inicio, fin);

        expect(inicio.getTime() - desde.getTime()).toBe(MARGEN_MINIMO_MIN * 60_000);
        expect(hasta.getTime() - fin.getTime()).toBe(MARGEN_MINIMO_MIN * 60_000);
      }),
      SEMILLA,
    );
  });

  it('parsearFecha nunca lanza para un ISO válido con offset explícito, y preserva el instante', () => {
    fc.assert(
      fc.property(arbDia, arbHora, (dia, hora) => {
        const iso = `${dia}T${hora}:00-03:00`;
        const fecha = parsearFecha(iso, 'campo');
        expect(fecha.getTime()).toBe(new Date(iso).getTime());
      }),
      SEMILLA,
    );
  });

  it('parsearFecha siempre lanza para basura que no es fecha', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => Number.isNaN(new Date(s).getTime())),
        (basura) => {
          expect(() => parsearFecha(basura, 'campo')).toThrow();
        },
      ),
      SEMILLA,
    );
  });

  it('huecosDelDia nunca devuelve un hueco que se superponga con un ocupado ensanchado por el margen', () => {
    fc.assert(
      fc.property(
        arbDia,
        fc.array(fc.integer({ min: 9 * 60, max: 17 * 60 }), { minLength: 0, maxLength: 5 }),
        (dia, iniciosOcupadosMin) => {
          if (!esDiaHabil(dia)) return; // huecosDelDia siempre [] en fin de semana, ya cubierto aparte.

          const ocupados: PeriodoOcupado[] = iniciosOcupadosMin.map((min) => {
            const inicio = fechaEnDia(dia, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
            return { inicio, fin: new Date(inicio.getTime() + 15 * 60_000) };
          });
          const desde = fechaEnDia(dia, AGENT_FRANJA.horaDesde);
          const huecos = huecosDelDia(AGENT_FRANJA, ocupados, dia, desde, 5);

          for (const hueco of huecos) {
            for (const ocupado of ocupados) {
              const [ocupadoDesde, ocupadoHasta] = conMargen(ocupado.inicio, ocupado.fin);
              const seSuperponen = hueco.inicio.getTime() < ocupadoHasta.getTime() && hueco.fin.getTime() > ocupadoDesde.getTime();
              expect(seSuperponen).toBe(false);
            }
          }
        },
      ),
      SEMILLA,
    );
  });

  it('huecosDelDia siempre devuelve [] para un día no hábil', () => {
    fc.assert(
      fc.property(arbDia, (dia) => {
        if (esDiaHabil(dia)) return;
        const huecos = huecosDelDia(AGENT_FRANJA, [], dia, fechaEnDia(dia, '00:00'), 5);
        expect(huecos).toEqual([]);
      }),
      SEMILLA,
    );
  });
});
