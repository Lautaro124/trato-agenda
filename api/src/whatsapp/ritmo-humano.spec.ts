import { describe, expect, it } from 'vitest';
import {
  ESPERA_RAFAGA_MS,
  MAXIMO_RAFAGA_MS,
  demoraDeEscritura,
  demoraRestante,
  esperaDeRafaga,
  partirEnMensajes,
} from './ritmo-humano.js';

describe('demoraDeEscritura', () => {
  it('crece con el largo del mensaje, entre un piso y un techo', () => {
    const corta = demoraDeEscritura('Dale', 0);
    const media = demoraDeEscritura('x'.repeat(100), 0);
    const larga = demoraDeEscritura('x'.repeat(5_000), 0);

    expect(corta).toBe(1_000);
    expect(media).toBeGreaterThan(corta);
    expect(larga).toBe(7_000);
  });

  it('el azar suma hasta un 20 %, nunca resta', () => {
    expect(demoraDeEscritura('Dale', 1)).toBe(1_200);
    expect(demoraDeEscritura('Dale', 0)).toBe(1_000);
  });
});

describe('demoraRestante', () => {
  it('descuenta lo que ya tardó el modelo y nunca da negativo', () => {
    expect(demoraRestante(3_000, 1_000)).toBe(2_000);
    expect(demoraRestante(3_000, 9_000)).toBe(0);
  });
});

describe('partirEnMensajes', () => {
  it('un bloque sin líneas en blanco es un solo mensaje, lista incluida', () => {
    expect(partirEnMensajes('El jueves tengo:\n* 10:00\n* 15:00')).toEqual(['El jueves tengo:\n* 10:00\n* 15:00']);
  });

  it('parte en cada línea en blanco y limpia los bordes', () => {
    expect(partirEnMensajes('  Hola!\n\n  \n¿Qué día te queda bien?  ')).toEqual(['Hola!', '¿Qué día te queda bien?']);
  });

  it('lo que pasa del máximo se junta en el último mensaje', () => {
    expect(partirEnMensajes('a\n\nb\n\nc\n\nd', 3)).toEqual(['a', 'b', 'c\n\nd']);
  });

  it('un texto vacío no manda nada', () => {
    expect(partirEnMensajes('  \n\n ')).toEqual([]);
  });
});

describe('esperaDeRafaga', () => {
  it('espera el silencio entero mientras no se pase del tope', () => {
    expect(esperaDeRafaga(0, 1_000)).toBe(ESPERA_RAFAGA_MS);
  });

  it('cerca del tope espera sólo lo que falta, y pasado el tope sale ya', () => {
    expect(esperaDeRafaga(0, MAXIMO_RAFAGA_MS - 1_000)).toBe(1_000);
    expect(esperaDeRafaga(0, MAXIMO_RAFAGA_MS + 5_000)).toBe(0);
  });
});
