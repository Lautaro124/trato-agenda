import { describe, expect, it } from 'vitest';
import { detalleDeTipo } from './precio.js';
import {
  detalleGrupal,
  esGrupal,
  normalizarTipoEvento,
  normalizarTiposEvento,
  resumenHorariosGrupales,
  tituloEventoGrupal,
} from './turnos-grupales.js';

const yoga = { nombre: ' Yoga ', duracionMin: 60, capacidad: 10, horarios: [{ dia: 'lun' as const, hora: '18:00' }] };

describe('normalizarTipoEvento', () => {
  it('un tipo sin capacidad queda individual, con el nombre recortado', () => {
    expect(normalizarTipoEvento({ nombre: ' Control ', duracionMin: 30, precio: 500 })).toEqual({
      tipo: { nombre: 'Control', duracionMin: 30, precio: 500 },
    });
  });

  it('un grupal queda con sus horarios ordenados y sin repetidos', () => {
    const resultado = normalizarTipoEvento({
      ...yoga,
      horarios: [
        { dia: 'vie', hora: '09:00' },
        { dia: 'lun', hora: '20:00' },
        { dia: 'lun', hora: '18:00' },
        { dia: 'vie', hora: '09:00' },
      ],
    });
    expect(resultado).toEqual({
      tipo: {
        nombre: 'Yoga',
        duracionMin: 60,
        capacidad: 10,
        horarios: [
          { dia: 'lun', hora: '18:00' },
          { dia: 'lun', hora: '20:00' },
          { dia: 'vie', hora: '09:00' },
        ],
      },
    });
  });

  it('acepta capacidad 1 y 100, y rechaza lo que no es un entero de 1 a 100', () => {
    expect(normalizarTipoEvento({ ...yoga, capacidad: 1 })).toHaveProperty('tipo');
    expect(normalizarTipoEvento({ ...yoga, capacidad: 100 })).toHaveProperty('tipo');
    for (const capacidad of [0, 101, 2.5, Number.NaN]) {
      expect(normalizarTipoEvento({ ...yoga, capacidad })).toEqual({
        error: 'La capacidad de "Yoga" tiene que ser un número entero de 1 a 100.',
      });
    }
  });

  it('pide al menos un horario y no acepta horarios sin capacidad', () => {
    expect(normalizarTipoEvento({ ...yoga, horarios: [] })).toEqual({ error: 'Poné al menos un horario para "Yoga".' });
    expect(normalizarTipoEvento({ nombre: 'Yoga', duracionMin: 60, horarios: yoga.horarios })).toEqual({
      error: '"Yoga" tiene horarios pero no cuántas personas entran.',
    });
  });

  it('rechaza una clase que termina pasada la medianoche o que se pisa con otra del mismo día', () => {
    expect(normalizarTipoEvento({ ...yoga, horarios: [{ dia: 'sab', hora: '23:30' }] })).toEqual({
      error: '"Yoga" del sábado a las 23:30 termina pasada la medianoche.',
    });
    expect(
      normalizarTipoEvento({
        ...yoga,
        horarios: [
          { dia: 'mar', hora: '18:00' },
          { dia: 'mar', hora: '18:30' },
        ],
      }),
    ).toEqual({ error: 'Los horarios de "Yoga" del martes se pisan.' });
    // Pegadas no se pisan.
    expect(
      normalizarTipoEvento({
        ...yoga,
        horarios: [
          { dia: 'mar', hora: '18:00' },
          { dia: 'mar', hora: '19:00' },
        ],
      }),
    ).toHaveProperty('tipo');
  });

  it('rechaza horarios con formato inválido aunque no pasen por el DTO', () => {
    expect(normalizarTipoEvento({ ...yoga, horarios: [{ dia: 'lun', hora: '8:00' }] })).toEqual({
      error: '"Yoga" tiene un horario con un formato inválido.',
    });
  });

  it('normalizarTiposEvento corta en el primer error', () => {
    expect(normalizarTiposEvento([{ nombre: 'A', duracionMin: 30 }, { ...yoga, horarios: [] }])).toEqual({
      error: 'Poné al menos un horario para "Yoga".',
    });
  });
});

describe('textos de un turno grupal', () => {
  it('resume los horarios por día', () => {
    expect(
      resumenHorariosGrupales([
        { dia: 'lun', hora: '09:00' },
        { dia: 'lun', hora: '18:00' },
        { dia: 'lun', hora: '20:00' },
        { dia: 'jue', hora: '18:00' },
      ]),
    ).toBe('lunes 09:00, 18:00 y 20:00; jueves 18:00');
  });

  it('el detalle va después de la duración y del precio', () => {
    const tipo = { duracionMin: 60, precio: 5000, capacidad: 1, horarios: [{ dia: 'dom' as const, hora: '10:00' }] };
    expect(detalleGrupal(tipo)).toBe('grupal de hasta 1 persona: domingo 10:00');
    expect(detalleDeTipo(tipo)).toBe('60 min, $ 5.000, grupal de hasta 1 persona: domingo 10:00');
    expect(detalleDeTipo({ duracionMin: 30 })).toBe('30 min');
  });

  it('esGrupal exige capacidad y horarios', () => {
    expect(esGrupal({ capacidad: 3, horarios: [{ dia: 'lun', hora: '10:00' }] })).toBe(true);
    expect(esGrupal({ capacidad: 3 })).toBe(false);
    expect(esGrupal({})).toBe(false);
  });

  it('el título del evento compartido lleva la cuenta, sin nombres', () => {
    expect(tituloEventoGrupal('Yoga', 3, 10)).toBe('Yoga (grupal) · 3/10');
    expect(tituloEventoGrupal('Yoga', 3)).toBe('Yoga (grupal) · 3 anotados');
  });
});
