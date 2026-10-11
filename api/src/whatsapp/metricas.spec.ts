import { describe, expect, it } from 'vitest';
import {
  CADA_CUANTOS_GUARDADOS,
  GUARDADO_LENTO_MS,
  MedidorDeGuardados,
  PREFIJO_TIEMPOS,
  demoraDeEntrega,
  resumenDeRafaga,
  timestampEnMs,
} from './metricas.js';

describe('resumenDeRafaga', () => {
  it('suma las etapas y sólo nombra al dueño, nunca al cliente', () => {
    const linea = resumenDeRafaga('user-1', {
      entregaMs: 30_000,
      esperaMs: 3_500,
      modeloMs: 4_200,
      envioMs: 2_000,
      mensajes: 2,
      partes: 1,
    });

    expect(linea.startsWith(PREFIJO_TIEMPOS)).toBe(true);
    expect(linea).toContain('user-1');
    expect(linea).toContain('entrega=30000ms');
    expect(linea).toContain('total=39700ms');
    expect(linea).toContain('mensajes=2');
  });

  it('sin timestamp de WhatsApp la entrega queda como desconocida y no suma', () => {
    const linea = resumenDeRafaga('user-1', {
      entregaMs: null,
      esperaMs: 100,
      modeloMs: 200,
      envioMs: 300,
      mensajes: 1,
      partes: 1,
    });

    expect(linea).toContain('entrega=?');
    expect(linea).toContain('total=600ms');
  });
});

describe('timestampEnMs', () => {
  it('pasa de segundos a milisegundos, sea número o Long', () => {
    expect(timestampEnMs(1_700_000_000)).toBe(1_700_000_000_000);
    // Los Long de protobuf se convierten con valueOf.
    expect(timestampEnMs({ valueOf: () => 1_700_000_000 })).toBe(1_700_000_000_000);
  });

  it('sin timestamp usable devuelve null', () => {
    expect(timestampEnMs(undefined)).toBeNull();
    expect(timestampEnMs(null)).toBeNull();
    expect(timestampEnMs(0)).toBeNull();
    expect(timestampEnMs('no')).toBeNull();
  });
});

describe('demoraDeEntrega', () => {
  it('mide desde el timestamp hasta que llegó, sin bajar de cero', () => {
    expect(demoraDeEntrega(1_000, 31_000)).toBe(30_000);
    expect(demoraDeEntrega(2_000, 1_500)).toBe(0);
    expect(demoraDeEntrega(null, 1_500)).toBeNull();
  });
});

describe('MedidorDeGuardados', () => {
  it('loguea un resumen cada CADA_CUANTOS_GUARDADOS y vuelve a contar', () => {
    const medidor = new MedidorDeGuardados('user-1');
    for (let i = 1; i < CADA_CUANTOS_GUARDADOS; i++) {
      expect(medidor.registrar(10, 20, 2048)).toBeNull();
    }
    const resumen = medidor.registrar(10, 50, 4096);

    expect(resumen).toContain(`${CADA_CUANTOS_GUARDADOS} guardados`);
    expect(resumen).toContain('maximo=60ms');
    expect(resumen).toContain('tamaño=4KB');
    expect(medidor.registrar(10, 20, 2048)).toBeNull();
  });

  it('un guardado lento se loguea en el momento, con cada parte por separado', () => {
    const medidor = new MedidorDeGuardados('user-1');
    const linea = medidor.registrar(GUARDADO_LENTO_MS, 1, 1024 * 900);

    expect(linea).toContain('guardado lento');
    expect(linea).toContain(`serializar=${GUARDADO_LENTO_MS}ms`);
    expect(linea).toContain('tamaño=900KB');
  });
});
