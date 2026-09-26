import { describe, expect, it } from 'vitest';
import { celdaCsv, diasEntre, MAX_DIAS_RANGO, RangoInvalidoError, rangoDeDias, ventasACsv } from './historico.rules.js';

describe('rangoDeDias', () => {
  it('por defecto son los últimos 30 días contando hoy, en la zona del negocio', () => {
    // 01:30 UTC del 27 es todavía el 26 en Buenos Aires.
    const rango = rangoDeDias(undefined, undefined, new Date('2026-09-27T01:30:00Z'));
    expect(rango).toMatchObject({ primerDia: '2026-08-28', ultimoDia: '2026-09-26' });
    expect(rango.desde.toISOString()).toBe('2026-08-28T03:00:00.000Z');
    expect(rango.hasta.toISOString()).toBe('2026-09-27T03:00:00.000Z');
  });

  it('respeta un rango pedido y cruza fines de mes y de año', () => {
    const rango = rangoDeDias('2026-12-31', '2027-01-01');
    expect(rango.hasta.toISOString()).toBe('2027-01-02T03:00:00.000Z');
    expect(diasEntre('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['26-09-01', '2026-09-02'],
    ['2026-09-10', '2026-09-01'],
  ])('rechaza %s..%s', (desde, hasta) => {
    expect(() => rangoDeDias(desde, hasta)).toThrow(RangoInvalidoError);
  });

  it(`no deja pedir más de ${MAX_DIAS_RANGO} días`, () => {
    expect(() => rangoDeDias('2024-01-01', '2026-01-01')).toThrow('hasta');
  });
});

describe('CSV', () => {
  it('neutraliza fórmulas y escapa separadores y comillas', () => {
    expect(celdaCsv('=HYPERLINK("http://malo")')).toBe(`"'=HYPERLINK(""http://malo"")"`);
    expect(celdaCsv('+54 9 11')).toBe("'+54 9 11");
    expect(celdaCsv('-1')).toBe("'-1");
    expect(celdaCsv('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(celdaCsv('Juan; Pérez')).toBe('"Juan; Pérez"');
    expect(celdaCsv(null)).toBe('');
  });

  it('arma una fila por venta con el estado visible y el BOM para Excel', () => {
    const csv = ventasACsv(
      [
        {
          createdAt: new Date('2026-09-26T20:42:00Z'),
          estado: 'pendiente_pago',
          reservaVenceAt: new Date('2026-09-26T21:12:00Z'),
          nombreCliente: '=cmd',
          telefonoCliente: '5491122334455',
          medioPago: 'mercadopago',
          totalCentavos: 1_600_050,
          pagadaAt: null,
          mpPaymentId: null,
          dePrueba: false,
          items: [{ cantidad: 2, nombreProducto: 'Mate', nombreVariante: '' }],
        },
      ],
      new Date('2026-09-27T00:00:00Z'),
    );
    const [encabezado, fila] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(encabezado).toBe('fecha;estado;cliente;telefono;medio_de_pago;productos;total;pagada_el;operacion_mercado_pago;prueba');
    expect(fila).toBe("sábado 26/9 a las 17:42;vencida;'=cmd;'+5491122334455;Mercado Pago;2 × Mate;$ 16.000,50;;;");
  });
});
