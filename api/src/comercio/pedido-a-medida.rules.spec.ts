import { describe, expect, it } from 'vitest';
import {
  armarSolicitudDeVenta,
  cambioMaterial,
  enAtencionHumana,
  estaAbierto,
  HORAS_LINK_A_MEDIDA,
  leerSolicitudDeVenta,
  transicionPermitida,
  vencimientoDeCobroAMedida,
} from './pedido-a-medida.rules.js';
import { estadoVisible, pagoSaldaVenta, reservaVigente } from './ventas.rules.js';

const AHORA = new Date('2026-10-16T12:00:00-03:00');

describe('transiciones de un pedido', () => {
  it('a medida: solicitado → a cotizar → cotizado → pendiente de pago → pagado', () => {
    expect(transicionPermitida('a_medida', 'solicitado', 'a_cotizar')).toBe(true);
    expect(transicionPermitida('a_medida', 'a_cotizar', 'cotizado')).toBe(true);
    expect(transicionPermitida('a_medida', 'cotizado', 'pendiente_pago')).toBe(true);
    expect(transicionPermitida('a_medida', 'pendiente_pago', 'pagada')).toBe(true);
  });

  it('a medida se puede recotizar mientras no se pagó, y cancelar en cualquier etapa abierta', () => {
    for (const de of ['cotizado', 'pendiente_pago', 'vencida'] as const) {
      expect(transicionPermitida('a_medida', de, 'cotizado')).toBe(true);
    }
    for (const de of ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] as const) {
      expect(transicionPermitida('a_medida', de, 'cancelada')).toBe(true);
    }
  });

  it('no se cobra sin presupuesto ni se deshace un pago', () => {
    expect(transicionPermitida('a_medida', 'a_cotizar', 'pendiente_pago')).toBe(false);
    expect(transicionPermitida('a_medida', 'solicitado', 'pagada')).toBe(false);
    expect(transicionPermitida('a_medida', 'pagada', 'cotizado')).toBe(false);
    expect(transicionPermitida('a_medida', 'cancelada', 'cotizado')).toBe(false);
  });

  it('un pedido del catálogo no pasa por la cotización', () => {
    expect(transicionPermitida('stock', 'pendiente_pago', 'pagada')).toBe(true);
    expect(transicionPermitida('stock', 'pendiente_pago', 'cotizado')).toBe(false);
    expect(transicionPermitida('otro', 'a_cotizar', 'cotizado')).toBe(false);
  });
});

describe('atención humana', () => {
  it('calla al asistente sólo mientras el pedido sigue abierto', () => {
    expect(enAtencionHumana({ atencion: 'humana', estado: 'a_cotizar' })).toBe(true);
    expect(enAtencionHumana({ atencion: 'humana', estado: 'vencida' })).toBe(true);
    expect(enAtencionHumana({ atencion: 'humana', estado: 'pagada' })).toBe(false);
    expect(enAtencionHumana({ atencion: 'humana', estado: 'cancelada' })).toBe(false);
    expect(enAtencionHumana({ atencion: 'asistente', estado: 'a_cotizar' })).toBe(false);
  });

  it('abiertos son los que todavía se pueden cotizar, cobrar o cancelar', () => {
    expect(['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'].every(estaAbierto)).toBe(true);
    expect(estaAbierto('pagada')).toBe(false);
  });
});

describe('estados de una venta sin cotizar', () => {
  it('sin importe ni reserva no retiene nada ni vence, y no se puede saldar', () => {
    const solicitud = { estado: 'a_cotizar', reservaVenceAt: null };
    expect(reservaVigente(solicitud, AHORA)).toBe(false);
    expect(estadoVisible(solicitud, AHORA)).toBe('a_cotizar');
    expect(
      pagoSaldaVenta(
        { status: 'approved', external_reference: 'v1', transaction_amount: 0, currency_id: 'ARS' },
        { id: 'v1', totalCentavos: null, moneda: 'ARS' },
      ),
    ).toBe(false);
  });

  it('un cobro a medida vale más que una reserva del catálogo', () => {
    expect(vencimientoDeCobroAMedida('mercadopago', AHORA).getTime() - AHORA.getTime()).toBe(
      HORAS_LINK_A_MEDIDA * 60 * 60 * 1000,
    );
    expect(vencimientoDeCobroAMedida('manual', AHORA).getTime()).toBeGreaterThan(
      vencimientoDeCobroAMedida('mercadopago', AHORA).getTime(),
    );
  });
});

describe('la solicitud guardada', () => {
  it('se arma en una línea y con topes, y se lee sin confiar en la forma', () => {
    const solicitud = armarSolicitudDeVenta({
      productoId: 'p1',
      nombreProducto: 'Placard',
      respuestas: [{ pregunta: 'Ancho\n(cm)', respuesta: ' 120 ' }],
      resumen: 'x'.repeat(2000),
    });
    expect(solicitud.respuestas).toEqual([{ pregunta: 'Ancho (cm)', respuesta: '120' }]);
    expect(solicitud.resumen).toHaveLength(600);
    expect(leerSolicitudDeVenta(solicitud)).toEqual(solicitud);
    expect(leerSolicitudDeVenta({ respuestas: [{ pregunta: 1 }], resumen: 3 })).toEqual({
      productoId: null,
      nombreProducto: null,
      respuestas: [],
      resumen: '',
    });
    expect(leerSolicitudDeVenta(null)).toBeNull();
  });

  it('un cambio de respuestas es material, el orden y las mayúsculas no', () => {
    const antes = [
      { pregunta: 'Ancho', respuesta: '120' },
      { pregunta: 'Color', respuesta: 'Blanco' },
    ];
    expect(cambioMaterial(antes, [...antes].reverse())).toBe(false);
    expect(cambioMaterial(antes, [{ pregunta: 'ancho', respuesta: '120' }, { pregunta: 'color', respuesta: 'BLANCO' }])).toBe(false);
    expect(cambioMaterial(antes, [{ pregunta: 'Ancho', respuesta: '140' }, antes[1]])).toBe(true);
    expect(cambioMaterial(antes, [antes[0]])).toBe(true);
  });
});
