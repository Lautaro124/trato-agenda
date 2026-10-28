import { describe, expect, it } from 'vitest';
import { rangoDeDias } from '../comercio/historico.rules.js';
import { cobertura, estadoDeChat, etapaDondeCortan, rangoAnterior, tasa } from './lectura.rules.js';

const AHORA = new Date('2026-10-22T12:00:00-03:00');
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 60 * 60 * 1000);

describe('tasa', () => {
  it('sin base no hay datos, que no es lo mismo que 0 %', () => {
    expect(tasa(0, 0)).toEqual({ valor: null });
    expect(tasa(0, 5)).toEqual({ valor: 0 });
  });

  it('redondea a cuatro decimales', () => {
    expect(tasa(1, 3)).toEqual({ valor: 0.3333 });
  });
});

describe('estadoDeChat', () => {
  it('un chat pagado está cerrado aunque no escriba hace meses', () => {
    expect(estadoDeChat('pagado', hace(24 * 90), AHORA)).toBe('cerrado');
  });

  it('activo hasta las 48 horas, estancado hasta los 7 días y después abandonado', () => {
    expect(estadoDeChat('vio_productos', hace(47), AHORA)).toBe('activo');
    expect(estadoDeChat('vio_productos', hace(48), AHORA)).toBe('estancado');
    expect(estadoDeChat('pedido', hace(24 * 7), AHORA)).toBe('estancado');
    expect(estadoDeChat('pedido', hace(24 * 7 + 1), AHORA)).toBe('abandonado');
  });
});

describe('rangoAnterior', () => {
  it('es el período del mismo largo que termina justo antes', () => {
    const rango = rangoDeDias('2026-10-01', '2026-10-31');
    const anterior = rangoAnterior(rango);
    expect([anterior.primerDia, anterior.ultimoDia]).toEqual(['2026-08-31', '2026-09-30']);
    expect(anterior.hasta).toEqual(rango.desde);
    expect(anterior.desde).toEqual(rangoDeDias('2026-08-31', '2026-09-30').desde);
  });
});

describe('cobertura', () => {
  const rango = rangoDeDias('2026-10-01', '2026-10-31');

  it('sin registros, o un período anterior al primero, no tiene datos', () => {
    expect(cobertura(rango, null)).toBe('sin_datos');
    expect(cobertura(rango, new Date('2026-11-05T10:00:00-03:00'))).toBe('sin_datos');
  });

  it('un período que empieza antes del primer registro tiene datos a medias', () => {
    expect(cobertura(rango, new Date('2026-10-10T10:00:00-03:00'))).toBe('parciales');
    expect(cobertura(rango, new Date('2026-09-10T10:00:00-03:00'))).toBe('completos');
  });
});

describe('etapaDondeCortan', () => {
  it('la etapa con más chats sin pagar, sin contar los pagados', () => {
    expect(etapaDondeCortan({ vio_productos: 2, pedido: 5, pagado: 9 })).toBe('pedido');
  });

  it('ante un empate, la más temprana; sin chats, ninguna', () => {
    expect(etapaDondeCortan({ pedido: 3, vio_productos: 3 })).toBe('vio_productos');
    expect(etapaDondeCortan({ pagado: 4 })).toBeNull();
  });
});
