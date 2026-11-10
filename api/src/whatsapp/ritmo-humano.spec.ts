import { describe, expect, it } from 'vitest';
import {
  esperaDeEscucha,
  MAX_ESCUCHA_AUDIO_MS,
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
    expect(larga).toBe(4_000);
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
  it('espera el silencio entero desde el último mensaje mientras no se pase del tope', () => {
    expect(esperaDeRafaga(0, 1_000, 1_000)).toBe(ESPERA_RAFAGA_MS);
    expect(esperaDeRafaga(0, 1_000, 3_000)).toBe(ESPERA_RAFAGA_MS - 2_000);
  });

  it('cerca del tope espera sólo lo que falta, y pasado el tope sale ya', () => {
    const cerca = MAXIMO_RAFAGA_MS - 1_000;
    expect(esperaDeRafaga(0, cerca, cerca)).toBe(1_000);
    expect(esperaDeRafaga(0, MAXIMO_RAFAGA_MS + 5_000, MAXIMO_RAFAGA_MS + 5_000)).toBe(0);
  });

  it('mientras el cliente escribe espera hasta que venza, aunque pase el silencio o el tope', () => {
    expect(esperaDeRafaga(0, 0, 1_000, 30_000)).toBe(29_000);
    expect(esperaDeRafaga(0, 0, MAXIMO_RAFAGA_MS + 1_000, MAXIMO_RAFAGA_MS + 3_000)).toBe(2_000);
  });

  it('si dejó de escribir hace rato, vuelve a mandar el silencio', () => {
    expect(esperaDeRafaga(0, 0, 1_000, 500)).toBe(ESPERA_RAFAGA_MS - 1_000);
  });
});

describe('esperaDeEscucha', () => {
  it('dura lo que el audio más 2 a 4 s, descontando el silencio que igual espera la ráfaga', () => {
    expect(esperaDeEscucha(30, 0) + ESPERA_RAFAGA_MS).toBe(32_000);
    expect(esperaDeEscucha(30, 1) + ESPERA_RAFAGA_MS).toBe(34_000);
  });

  it('un audio corto no espera más que su duración y la reacción', () => {
    expect(esperaDeEscucha(2, 1) + ESPERA_RAFAGA_MS).toBe(6_000);
    expect(esperaDeEscucha(0, 0.5)).toBe(0);
  });

  it('un audio largo se escucha hasta MAX_ESCUCHA_AUDIO_MS, no su duración entera', () => {
    expect(esperaDeEscucha(90 * 60, 0) + ESPERA_RAFAGA_MS).toBe(MAX_ESCUCHA_AUDIO_MS + 2_000);
    expect(esperaDeEscucha(120, 0)).toBe(esperaDeEscucha(90 * 60, 0));
  });
});
