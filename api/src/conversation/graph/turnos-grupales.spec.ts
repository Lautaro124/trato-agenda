import { describe, expect, it } from 'vitest';
import {
  anotadosPorClase,
  bloqueTurnosGrupales,
  claseEn,
  clasesDelDia,
  clasesEnRango,
  conAnotado,
  lugaresLibres,
  proximasConLugar,
  sinAnotado,
  tipoPorNombre,
} from './turnos-grupales.js';

/** El 1/9/2026 es martes. */
function fecha(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00-03:00`);
}

const TIPOS = [
  { nombre: 'Masaje', duracionMin: 30 },
  {
    nombre: 'Yoga',
    duracionMin: 60,
    capacidad: 2,
    horarios: [
      { dia: 'mar' as const, hora: '12:00' },
      { dia: 'sab' as const, hora: '10:00' },
    ],
  },
];

describe('clasesEnRango', () => {
  it('arma las clases de cada día de la semana, fines de semana incluidos, en la zona del negocio', () => {
    const clases = clasesEnRango(TIPOS, fecha('2026-09-01', '08:00'), fecha('2026-09-09', '08:00'));
    expect(clases.map((clase) => clase.inicio.toISOString())).toEqual([
      '2026-09-01T15:00:00.000Z',
      '2026-09-05T13:00:00.000Z',
      '2026-09-08T15:00:00.000Z',
    ]);
    expect(clases[0]).toMatchObject({ tipo: 'Yoga', capacidad: 2, fin: fecha('2026-09-01', '13:00') });
  });

  it('incluye la clase en curso (sigue ocupando la agenda) y no las que ya terminaron', () => {
    const enCurso = clasesEnRango(TIPOS, fecha('2026-09-01', '12:30'), fecha('2026-09-02', '00:00'));
    expect(enCurso).toHaveLength(1);
    expect(clasesEnRango(TIPOS, fecha('2026-09-01', '13:00'), fecha('2026-09-02', '00:00'))).toEqual([]);
  });

  it('sin tipos grupales no hay clases', () => {
    expect(clasesEnRango([TIPOS[0]], fecha('2026-09-01', '08:00'), fecha('2026-09-15', '08:00'))).toEqual([]);
  });
});

describe('tipoPorNombre', () => {
  it('reconoce el tipo sin mayúsculas ni tildes, o contenido como palabra entera', () => {
    const tipos = [{ nombre: 'Yoga' }, { nombre: 'Clase de Música' }];
    expect(tipoPorNombre(tipos, 'YOGA')?.nombre).toBe('Yoga');
    expect(tipoPorNombre(tipos, 'clase de musica')?.nombre).toBe('Clase de Música');
    expect(tipoPorNombre(tipos, 'Yoga - Juan')?.nombre).toBe('Yoga');
    expect(tipoPorNombre(tipos, 'yogurt')).toBeNull();
    expect(tipoPorNombre(tipos, undefined)).toBeNull();
  });

  it('con más de un tipo posible no adivina', () => {
    expect(tipoPorNombre([{ nombre: 'Yoga' }, { nombre: 'Pilates' }], 'yoga y pilates')).toBeNull();
  });
});

describe('lugares de una clase', () => {
  const clases = clasesEnRango(TIPOS, fecha('2026-09-01', '08:00'), fecha('2026-09-09', '08:00'));
  const [martes, sabado] = clases;

  it('cuenta los anotados por clase a partir de los turnos con tipo', () => {
    const anotados = anotadosPorClase([
      { tipo: 'Yoga', inicio: martes.inicio, conversationId: 'c1' },
      { tipo: 'yoga', inicio: martes.inicio, conversationId: 'c2' },
      { tipo: null, inicio: martes.inicio, conversationId: 'c3' },
    ]);
    expect(lugaresLibres(anotados, martes)).toBe(0);
    expect(lugaresLibres(anotados, sabado)).toBe(2);
    expect(proximasConLugar(clases, anotados, 'Yoga').map((clase) => clase.inicio)).toEqual([
      sabado.inicio,
      clases[2].inicio,
    ]);
  });

  it('conAnotado y sinAnotado no tocan el mapa original', () => {
    const vacio = anotadosPorClase([]);
    const uno = conAnotado(vacio, martes, 'c1');
    expect(lugaresLibres(vacio, martes)).toBe(2);
    expect(lugaresLibres(uno, martes)).toBe(1);
    expect(lugaresLibres(sinAnotado(uno, 'Yoga', martes.inicio, 'c1'), martes)).toBe(2);
    expect(lugaresLibres(uno, martes)).toBe(1);
  });

  it('claseEn exige el mismo tipo y el inicio exacto', () => {
    expect(claseEn(clases, 'yoga', fecha('2026-09-01', '12:00'))).toBe(martes);
    expect(claseEn(clases, 'Yoga', fecha('2026-09-01', '12:05'))).toBeNull();
    expect(claseEn(clases, 'Masaje', fecha('2026-09-01', '12:00'))).toBeNull();
  });

  it('el bloque del prompt dice los lugares sin nombres y marca las completas', () => {
    const anotados = anotadosPorClase([
      { tipo: 'Yoga', inicio: martes.inicio, conversationId: 'c1' },
      { tipo: 'Yoga', inicio: martes.inicio, conversationId: 'c2' },
      { tipo: 'Yoga', inicio: sabado.inicio, conversationId: 'c1' },
    ]);
    const bloque = bloqueTurnosGrupales({ clases, anotados });
    expect(bloque).toMatch(/- Yoga: martes 1[/-]9 12:00 \(completa\) · sábado 5[/-]9 10:00 \(queda 1 lugar de 2\)/);
    expect(bloqueTurnosGrupales({ clases: [], anotados })).toBe('');
    expect(clasesDelDia({ clases, anotados }, '2026-09-05')).toBe(
      ' Ese día también hay clases grupales: Yoga a las 10:00 (queda 1 lugar de 2).',
    );
    expect(clasesDelDia({ clases, anotados }, '2026-09-02')).toBe('');
  });
});
