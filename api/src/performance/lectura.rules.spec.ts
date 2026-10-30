import { describe, expect, it } from 'vitest';
import { rangoDeDias } from '../comercio/historico.rules.js';
import { cobertura, completarDias, estadoDeChat, etapaDondeCortan, rangoAnterior, sumarDias, tasa } from './lectura.rules.js';

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

describe('completarDias y sumarDias', () => {
  const rango = rangoDeDias('2026-10-01', '2026-10-03');

  it('un día por día del rango, juntando chats y ventas del mismo día y con cero en los vacíos', () => {
    const dias = completarDias(rango, [
      { dia: '2026-10-01', chats: 3, conPedido: 1, conPago: 1 },
      { dia: '2026-10-01', pedidos: 2, pagados: 1, cobradoCentavos: 150_000 },
      { dia: '2026-10-03', chats: 1, conPedido: 0, conPago: 0 },
    ]);
    expect(dias).toEqual([
      { dia: '2026-10-01', chats: 3, conPedido: 1, pedidos: 2, pagados: 1, conPago: 1, cobradoCentavos: 150_000 },
      { dia: '2026-10-02', chats: 0, conPedido: 0, pedidos: 0, pagados: 0, conPago: 0, cobradoCentavos: 0 },
      { dia: '2026-10-03', chats: 1, conPedido: 0, pedidos: 0, pagados: 0, conPago: 0, cobradoCentavos: 0 },
    ]);
    expect(sumarDias(dias)).toEqual({ chats: 4, conPedido: 1, pedidos: 2, pagados: 1, conPago: 1, cobradoCentavos: 150_000 });
  });

  it('un período sin días suma cero', () => {
    expect(sumarDias([])).toEqual({ chats: 0, conPedido: 0, pedidos: 0, pagados: 0, conPago: 0, cobradoCentavos: 0 });
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
