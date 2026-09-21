import { describe, expect, it } from 'vitest';
import {
  DIAS_RETENCION_DATOS_CLIENTE,
  DIAS_RETENCION_MENSAJES,
  fechaLimite,
  fechaLimiteHoras,
  HORAS_ALTA_PENDIENTE,
} from './retention.rules.js';

describe('retention.rules', () => {
  it('fechaLimite resta los días pedidos al momento dado', () => {
    const ahora = new Date('2026-09-12T12:00:00Z');

    expect(fechaLimite(90, ahora).toISOString()).toBe('2026-06-14T12:00:00.000Z');
  });

  it('los mensajes se borran antes que el nombre y el resumen del cliente', () => {
    // Si esto se invierte, se estaría conservando el texto de las charlas más
    // tiempo que los datos derivados, que es exactamente al revés de lo que
    // dice /privacidad.
    expect(DIAS_RETENCION_MENSAJES).toBeLessThan(DIAS_RETENCION_DATOS_CLIENTE);
  });

  it('fechaLimiteHoras resta horas', () => {
    const ahora = new Date('2026-09-12T12:00:00Z');

    expect(fechaLimiteHoras(HORAS_ALTA_PENDIENTE, ahora).toISOString()).toBe('2026-09-12T11:00:00.000Z');
  });

  it('un alta pendiente dura más que su cookie (15 minutos): no se borra en medio del escaneo', () => {
    expect(HORAS_ALTA_PENDIENTE * 60).toBeGreaterThan(15);
  });
});
