import { describe, expect, it } from 'vitest';
import { DIAS_AVISO, DIAS_PRUEBA, estadoDeSuscripcion, finDePrueba } from './subscription.rules.js';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Un usuario que se registró hace `dias` días. */
function creadoHace(dias: number): Date {
  return new Date(Date.now() - dias * MS_POR_DIA);
}

describe('estadoDeSuscripcion', () => {
  it('recién registrado: está en prueba y el asistente responde', () => {
    const estado = estadoDeSuscripcion({ creadoEl: creadoHace(1), suscripcion: null });

    expect(estado.estado).toBe('prueba');
    expect(estado.diasRestantes).toBe(DIAS_PRUEBA - 1);
    expect(estado.asistenteActivo).toBe(true);
  });

  it(`a ${DIAS_PRUEBA - DIAS_AVISO} días del alta pasa a por_vencer`, () => {
    const estado = estadoDeSuscripcion({
      creadoEl: creadoHace(DIAS_PRUEBA - DIAS_AVISO),
      suscripcion: null,
    });

    expect(estado.estado).toBe('por_vencer');
    expect(estado.diasRestantes).toBe(DIAS_AVISO);
    expect(estado.asistenteActivo).toBe(true);
  });

  it('el día 31 la prueba está vencida y el asistente se apaga', () => {
    const estado = estadoDeSuscripcion({ creadoEl: creadoHace(DIAS_PRUEBA + 1), suscripcion: null });

    expect(estado.estado).toBe('vencida');
    expect(estado.diasRestantes).toBe(0);
    expect(estado.asistenteActivo).toBe(false);
  });

  it('una suscripción activa gana sobre la prueba vencida', () => {
    const estado = estadoDeSuscripcion({
      creadoEl: creadoHace(DIAS_PRUEBA + 100),
      suscripcion: { estado: 'activa' },
    });

    expect(estado.estado).toBe('activa');
    expect(estado.asistenteActivo).toBe(true);
  });

  it('una suscripción pendiente o cancelada no salva una prueba vencida', () => {
    for (const estadoFila of ['pendiente', 'pausada', 'cancelada']) {
      const estado = estadoDeSuscripcion({
        creadoEl: creadoHace(DIAS_PRUEBA + 1),
        suscripcion: { estado: estadoFila },
      });

      expect(estado.estado).toBe('vencida');
      expect(estado.asistenteActivo).toBe(false);
    }
  });

  it('quedando media hora todavía dice "1 día", no "0"', () => {
    const creadoEl = new Date(Date.now() - DIAS_PRUEBA * MS_POR_DIA + 30 * 60 * 1000);
    const estado = estadoDeSuscripcion({ creadoEl, suscripcion: null });

    expect(estado.diasRestantes).toBe(1);
    expect(estado.asistenteActivo).toBe(true);
  });

  it('finDePrueba cae exactamente a los DIAS_PRUEBA días del alta', () => {
    const creadoEl = new Date('2026-09-08T12:00:00.000Z');

    expect(finDePrueba(creadoEl).toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });
});
