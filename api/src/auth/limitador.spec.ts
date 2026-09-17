import { describe, expect, it } from 'vitest';
import { Limitador, normalizarTelefono } from './limitador.js';

describe('Limitador', () => {
  it('deja pasar hasta el máximo dentro de la ventana y corta el siguiente', () => {
    const limitador = new Limitador(2, 60_000);

    expect(limitador.permitir('ip-1', 0)).toBe(true);
    expect(limitador.permitir('ip-1', 1_000)).toBe(true);
    expect(limitador.permitir('ip-1', 2_000)).toBe(false);
  });

  it('vuelve a dejar pasar cuando los intentos viejos salen de la ventana', () => {
    const limitador = new Limitador(1, 60_000);

    expect(limitador.permitir('ip-1', 0)).toBe(true);
    expect(limitador.permitir('ip-1', 59_999)).toBe(false);
    expect(limitador.permitir('ip-1', 60_000)).toBe(true);
  });

  it('las claves no se mezclan', () => {
    const limitador = new Limitador(1, 60_000);

    expect(limitador.permitir('ip-1', 0)).toBe(true);
    expect(limitador.permitir('ip-2', 0)).toBe(true);
  });

  it('un intento rechazado no alarga el bloqueo', () => {
    const limitador = new Limitador(1, 60_000);
    limitador.permitir('ip-1', 0);
    limitador.permitir('ip-1', 30_000);

    expect(limitador.permitir('ip-1', 60_000)).toBe(true);
  });
});

describe('normalizarTelefono', () => {
  it('se queda sólo con los dígitos', () => {
    expect(normalizarTelefono('+54 9 11 2233-4455')).toBe('5491122334455');
  });
});
