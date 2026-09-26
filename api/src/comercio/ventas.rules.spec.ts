import { describe, expect, it } from 'vitest';
import {
  agruparItems,
  detalleDeRenglones,
  fechaYHora,
  estadoVisible,
  MAX_CANTIDAD_POR_ITEM,
  MAX_ITEMS_POR_PEDIDO,
  MINUTOS_RESERVA_MP,
  pagoSaldaVenta,
  problemaDeForma,
  reservaVigente,
  telefonoDeJid,
  vencimientoDeReserva,
} from './ventas.rules.js';

const AHORA = new Date('2026-09-26T15:00:00-03:00');
const minutos = (n: number) => new Date(AHORA.getTime() + n * 60_000);

describe('reservas', () => {
  it('una pendiente sin vencer retiene; vencida, pagada o cancelada no', () => {
    expect(reservaVigente({ estado: 'pendiente_pago', reservaVenceAt: minutos(1) }, AHORA)).toBe(true);
    expect(reservaVigente({ estado: 'pendiente_pago', reservaVenceAt: minutos(0) }, AHORA)).toBe(false);
    expect(reservaVigente({ estado: 'pagada', reservaVenceAt: minutos(10) }, AHORA)).toBe(false);
    expect(reservaVigente({ estado: 'cancelada', reservaVenceAt: minutos(10) }, AHORA)).toBe(false);
  });

  it('muestra como vencida una pendiente pasada de hora, aunque el barrido no haya corrido', () => {
    expect(estadoVisible({ estado: 'pendiente_pago', reservaVenceAt: minutos(-1) }, AHORA)).toBe('vencida');
    expect(estadoVisible({ estado: 'pendiente_pago', reservaVenceAt: minutos(5) }, AHORA)).toBe('pendiente_pago');
    expect(estadoVisible({ estado: 'pagada', reservaVenceAt: minutos(-100) }, AHORA)).toBe('pagada');
  });

  it('Mercado Pago reserva 30 minutos y lo manual 24 horas', () => {
    expect(vencimientoDeReserva('mercadopago', AHORA)).toEqual(minutos(MINUTOS_RESERVA_MP));
    expect(vencimientoDeReserva('manual', AHORA)).toEqual(minutos(24 * 60));
  });
});

describe('forma del pedido', () => {
  it('junta renglones de la misma variante', () => {
    expect(
      agruparItems([
        { varianteId: 'a', cantidad: 2 },
        { varianteId: 'b', cantidad: 1 },
        { varianteId: 'a', cantidad: 1 },
      ]),
    ).toEqual([
      { varianteId: 'a', cantidad: 3 },
      { varianteId: 'b', cantidad: 1 },
    ]);
  });

  it('rechaza pedidos vacíos, cantidades raras y los que pasan los topes', () => {
    expect(problemaDeForma([])).toContain('no tiene productos');
    expect(problemaDeForma([{ varianteId: 'a', cantidad: 0 }])).toContain('mayor que cero');
    expect(problemaDeForma([{ varianteId: 'a', cantidad: 1.5 }])).toContain('entero');
    expect(problemaDeForma([{ varianteId: 'a', cantidad: MAX_CANTIDAD_POR_ITEM + 1 }])).toContain('hasta');
    // Repartido en dos renglones igual cuenta el total.
    expect(
      problemaDeForma([
        { varianteId: 'a', cantidad: MAX_CANTIDAD_POR_ITEM },
        { varianteId: 'a', cantidad: 1 },
      ]),
    ).toContain('hasta');
    const muchos = Array.from({ length: MAX_ITEMS_POR_PEDIDO + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }));
    expect(problemaDeForma(muchos)).toContain('productos distintos');
    expect(problemaDeForma([{ varianteId: 'a', cantidad: 2 }])).toBeNull();
  });
});

describe('pagoSaldaVenta', () => {
  const venta = { id: 'venta-1', totalCentavos: 1_600_050, moneda: 'ARS' };
  const pago = { status: 'approved', external_reference: 'venta-1', transaction_amount: 16000.5, currency_id: 'ARS' };

  it('acepta un pago aprobado, de esta venta, por el monto exacto', () => {
    expect(pagoSaldaVenta(pago, venta)).toBe(true);
  });

  it.each([
    ['pendiente', { status: 'pending' }],
    ['de otra venta', { external_reference: 'venta-2' }],
    ['por otro monto', { transaction_amount: 1 }],
    ['en otra moneda', { currency_id: 'USD' }],
  ])('rechaza un pago %s', (_, cambio) => {
    expect(pagoSaldaVenta({ ...pago, ...cambio }, venta)).toBe(false);
  });
});

describe('telefonoDeJid', () => {
  it('saca el número de un chat de WhatsApp y descarta el resto', () => {
    expect(telefonoDeJid('5491122334455@s.whatsapp.net')).toBe('5491122334455');
    expect(telefonoDeJid('web-test:user-1')).toBeNull();
    expect(telefonoDeJid('120363@g.us')).toBeNull();
  });
});

describe('detalleDeRenglones', () => {
  it('arma el detalle legible de una venta', () => {
    expect(
      detalleDeRenglones([
        { nombreProducto: 'Mate', nombreVariante: '', cantidad: 2, subtotalCentavos: 1_600_000 },
        { nombreProducto: 'Remera', nombreVariante: 'Talle M', cantidad: 1, subtotalCentavos: 1_500_000 },
      ]),
    ).toBe('2 × Mate ($ 16.000), 1 × Remera (Talle M) ($ 15.000)');
  });
});

describe('fechaYHora', () => {
  it('escribe día, fecha y hora de 24 horas en la zona del negocio', () => {
    expect(fechaYHora(new Date('2026-09-26T20:42:00Z'))).toBe('sábado 26/9 a las 17:42');
    expect(fechaYHora(new Date('2026-12-01T03:05:00Z'))).toBe('martes 1/12 a las 00:05');
  });
});
