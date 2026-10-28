import { describe, expect, it } from 'vitest';
import {
  DIAS_AVISO,
  DIAS_PRUEBA,
  estadoDeCupo,
  estadoDeSuscripcion,
  finDePrueba,
  funcionesDelPlan,
  limiteDeChats,
  planVigente,
  rangoDelMes,
} from './subscription.rules.js';

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

describe('planes y cupo de chats', () => {
  it('el Básico tiene 1.500 chats, el Pro 4.500, y la prueba muestra el del Pro', () => {
    expect(limiteDeChats('basico')).toBe(1500);
    expect(limiteDeChats('pro')).toBe(4500);
    expect(limiteDeChats(null)).toBe(4500);
    expect(limiteDeChats('desconocido')).toBe(1500);
  });

  it('sólo una suscripción activa tiene plan, y la importación rápida es del Pro', () => {
    expect(planVigente({ estado: 'activa' }, 'pro')).toBe('pro');
    expect(planVigente({ estado: 'activa' }, 'raro')).toBe('basico');
    expect(planVigente({ estado: 'prueba' }, 'pro')).toBeNull();
    expect(planVigente({ estado: 'vencida' }, 'pro')).toBeNull();
    expect(planVigente({ estado: 'activa' }, null)).toBeNull();

    expect(funcionesDelPlan('pro')).toEqual({ importacionRapida: true });
    expect(funcionesDelPlan('basico')).toEqual({ importacionRapida: false });
    // El mes de prueba incluye todo menos lo que es sólo del Pro pagando.
    expect(funcionesDelPlan(null)).toEqual({ importacionRapida: false });
  });

  it('avisa desde el 80 % y marca superado al llegar al tope', () => {
    expect(estadoDeCupo({ usados: 1199, plan: 'basico' })).toMatchObject({ cercano: false, superado: false, restantes: 301 });
    expect(estadoDeCupo({ usados: 1200, plan: 'basico' })).toMatchObject({ cercano: true, superado: false, porcentaje: 80 });
    expect(estadoDeCupo({ usados: 1500, plan: 'basico' })).toMatchObject({ cercano: true, superado: true, restantes: 0 });
    expect(estadoDeCupo({ usados: 9000, plan: 'pro' })).toMatchObject({ superado: true, restantes: 0 });
  });

  it('el mes se corta a medianoche de Buenos Aires (UTC-3), no de UTC', () => {
    // 1° de noviembre 01:00 UTC = 31 de octubre 22:00 en Buenos Aires: sigue siendo octubre.
    const finDeOctubre = rangoDelMes(new Date('2026-11-01T01:00:00.000Z'));
    expect(finDeOctubre.etiqueta).toBe('2026-10');
    expect(finDeOctubre.desde.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(finDeOctubre.hasta.toISOString()).toBe('2026-11-01T03:00:00.000Z');

    expect(rangoDelMes(new Date('2026-11-01T03:00:00.000Z')).etiqueta).toBe('2026-11');
    expect(rangoDelMes(new Date('2026-12-15T12:00:00.000Z')).hasta.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});
