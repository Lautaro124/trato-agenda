import { describe, expect, it } from 'vitest';
import {
  descuentoEfectivo,
  filaDeCobroManual,
  normalizarCobroManual,
  hayCondiciones,
  leerCondiciones,
  MAX_PLANES_CUOTAS,
  normalizarCondiciones,
  planesEn,
  problemaDeFormaDePago,
  recargoDe,
  SIN_CONDICIONES,
  topeDelPedido,
  valorDeCuota,
  type CondicionesPago,
} from './condiciones-pago.rules.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';

const CONDICIONES: CondicionesPago = {
  planesCuotas: [
    { cuotas: 3, recargoPorcentaje: 0 },
    { cuotas: 6, recargoPorcentaje: 15 },
  ],
  descuentoEfectivoPorcentaje: 10,
  cobroManual: null,
};

describe('normalizarCondiciones', () => {
  it('ordena los planes por cantidad de cuotas', () => {
    const resultado = normalizarCondiciones({
      planesCuotas: [
        { cuotas: 12, recargoPorcentaje: 30 },
        { cuotas: 3, recargoPorcentaje: 0 },
      ],
      descuentoEfectivoPorcentaje: null,
    });
    expect(resultado).toEqual({
      condiciones: {
        planesCuotas: [
          { cuotas: 3, recargoPorcentaje: 0 },
          { cuotas: 12, recargoPorcentaje: 30 },
        ],
        descuentoEfectivoPorcentaje: null,
        cobroManual: null,
      },
    });
  });

  it.each([
    [{ planesCuotas: [{ cuotas: 1, recargoPorcentaje: 0 }] }, 'cuotas'],
    [{ planesCuotas: [{ cuotas: 25, recargoPorcentaje: 0 }] }, 'cuotas'],
    [{ planesCuotas: [{ cuotas: 3.5, recargoPorcentaje: 0 }] }, 'cuotas'],
    [{ planesCuotas: [{ cuotas: 3, recargoPorcentaje: -1 }] }, 'recargo'],
    [{ planesCuotas: [{ cuotas: 3, recargoPorcentaje: 101 }] }, 'recargo'],
    [{ planesCuotas: [{ cuotas: 3, recargoPorcentaje: 0 }, { cuotas: 3, recargoPorcentaje: 10 }] }, 'dos planes'],
    [{ planesCuotas: 'tres' }, 'planes'],
    [{ descuentoEfectivoPorcentaje: 0 }, 'efectivo'],
    [{ descuentoEfectivoPorcentaje: 91 }, 'efectivo'],
  ])('rechaza %j', (entrada, motivo) => {
    const resultado = normalizarCondiciones(entrada);
    expect('error' in resultado && resultado.error).toContain(motivo);
  });

  it(`acepta hasta ${MAX_PLANES_CUOTAS} planes`, () => {
    const planes = Array.from({ length: MAX_PLANES_CUOTAS + 1 }, (_, i) => ({ cuotas: i + 2, recargoPorcentaje: 0 }));
    expect('error' in normalizarCondiciones({ planesCuotas: planes.slice(0, -1) })).toBe(false);
    expect('error' in normalizarCondiciones({ planesCuotas: planes })).toBe(true);
  });
});

describe('leerCondiciones', () => {
  it('sin fila o con una rota no ofrece nada', () => {
    expect(leerCondiciones(null)).toEqual(SIN_CONDICIONES);
    expect(leerCondiciones({ planesCuotas: [{ cuotas: 'x' }], descuentoEfectivoPorcentaje: 10 })).toEqual(SIN_CONDICIONES);
    expect(hayCondiciones(SIN_CONDICIONES)).toBe(false);
    expect(hayCondiciones(CONDICIONES)).toBe(true);
  });
});

describe('cobro manual', () => {
  it('normaliza el alias y el titular de una transferencia', () => {
    expect(normalizarCobroManual({ modo: 'transferencia', alias: ' Mi.Tienda.MP ', titular: ' Ana   Pérez ', mensaje: 'x' })).toEqual({
      cobroManual: { modo: 'transferencia', alias: 'mi.tienda.mp', titular: 'Ana Pérez' },
    });
    expect(normalizarCobroManual({ modo: 'transferencia', alias: '0'.repeat(22), titular: 'Ana' })).toEqual({
      cobroManual: { modo: 'transferencia', alias: '0'.repeat(22), titular: 'Ana' },
    });
  });

  it('acepta un mensaje de otro canal con sus variables', () => {
    expect(normalizarCobroManual({ modo: 'otro_canal', mensaje: '  Hola {nombre}, te cobramos {total} desde el 11-5555  ' })).toEqual({
      cobroManual: { modo: 'otro_canal', mensaje: 'Hola {nombre}, te cobramos {total} desde el 11-5555' },
    });
  });

  it('null o ausente es coordinar por el chat', () => {
    expect(normalizarCobroManual(null)).toEqual({ cobroManual: null });
    expect(normalizarCobroManual(undefined)).toEqual({ cobroManual: null });
  });

  it.each([
    [{ modo: 'otro' }, 'no es válida'],
    [{ modo: 'transferencia', alias: 'abc', titular: 'Ana' }, 'alias'],
    [{ modo: 'transferencia', alias: 'alias con espacio!', titular: 'Ana' }, 'alias'],
    [{ modo: 'transferencia', alias: 'mi.alias', titular: '  ' }, 'nombre de quién'],
    [{ modo: 'transferencia', alias: 'mi.alias', titular: 'a'.repeat(81) }, 'titular'],
    [{ modo: 'otro_canal', mensaje: '' }, 'Escribí el mensaje'],
    [{ modo: 'otro_canal', mensaje: 'a'.repeat(401) }, 'como mucho'],
    [{ modo: 'otro_canal', mensaje: 'Pagá a {link}' }, '{link}'],
  ])('rechaza %j', (entrada, motivo) => {
    const resultado = normalizarCobroManual(entrada);
    expect('error' in resultado && resultado.error).toContain(motivo);
  });

  it('se guarda plano y se vuelve a leer igual', () => {
    const cobro = { modo: 'transferencia' as const, alias: 'mi.alias', titular: 'Ana' };
    const fila = { planesCuotas: [], descuentoEfectivoPorcentaje: null, ...filaDeCobroManual(cobro) };
    expect(fila.mensajeCobroManual).toBeNull();
    expect(leerCondiciones(fila).cobroManual).toEqual(cobro);
  });

  it('uno roto queda como coordinar por el chat sin llevarse las cuotas', () => {
    const fila = {
      planesCuotas: [{ cuotas: 3, recargoPorcentaje: 0 }],
      descuentoEfectivoPorcentaje: null,
      cobroManual: 'transferencia',
      aliasTransferencia: null,
      titularTransferencia: null,
      mensajeCobroManual: null,
    };
    expect(leerCondiciones(fila)).toEqual({ ...SIN_CONDICIONES, planesCuotas: [{ cuotas: 3, recargoPorcentaje: 0 }] });
  });
});

describe('montos', () => {
  it('el recargo es un porcentaje del total, redondeado al centavo', () => {
    expect(recargoDe(1_000_000, { cuotas: 6, recargoPorcentaje: 15 })).toBe(150_000);
    expect(recargoDe(333, { cuotas: 6, recargoPorcentaje: 15 })).toBe(50);
    expect(recargoDe(1_000_000, { cuotas: 3, recargoPorcentaje: 0 })).toBe(0);
  });

  it('las cuotas redondean para arriba: nunca cubren menos que el total', () => {
    expect(valorDeCuota(1_000_000, 3)).toBe(333_334);
    expect(valorDeCuota(1_000_000, 3) * 3).toBeGreaterThanOrEqual(1_000_000);
  });

  it('el tope de un pedido es el más bajo de sus productos', () => {
    expect(topeDelPedido([null, 6, 3])).toBe(3);
    expect(topeDelPedido([null, null])).toBeNull();
    expect(planesEn(CONDICIONES, 'ARS', 4)).toEqual([{ cuotas: 3, recargoPorcentaje: 0 }]);
    expect(planesEn(CONDICIONES, 'ARS', 1)).toEqual([]);
  });

  it('en dólares no hay cuotas', () => {
    expect(planesEn(CONDICIONES, 'USD')).toEqual([]);
    expect(planesEn(CONDICIONES, 'ARS')).toHaveLength(2);
  });
});

describe('descuento en efectivo', () => {
  const MATE = { id: 'p-mate', categoria: 'Mates' };
  const promo: DescuentoParaAplicar = {
    id: 'promo',
    productoId: null,
    categoria: 'Mates',
    nombre: 'Semana del mate',
    tipo: 'porcentaje',
    valor: 20,
    activo: true,
    desde: null,
    hasta: null,
  };

  it('compite con las promos y gana el mayor, sin sumarse', () => {
    const efectivo = descuentoEfectivo(CONDICIONES) as DescuentoParaAplicar;
    expect(mejorDescuento([promo, efectivo], MATE, 10_000)?.descuentoCentavos).toBe(2_000);
    expect(mejorDescuento([efectivo], MATE, 10_000)?.descuentoCentavos).toBe(1_000);
    expect(mejorDescuento([{ ...promo, valor: 5 }, efectivo], MATE, 10_000)?.etiqueta).toBe('10% off');
  });

  it('no hay descuento sintético sin porcentaje configurado', () => {
    expect(descuentoEfectivo(SIN_CONDICIONES)).toBeNull();
  });
});

describe('problemaDeFormaDePago', () => {
  it('contado siempre se puede', () => {
    expect(problemaDeFormaDePago(SIN_CONDICIONES, null, null, 'ARS')).toBeNull();
  });

  it('sólo los planes y el efectivo configurados', () => {
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 6, 'ARS')).toBeNull();
    expect(problemaDeFormaDePago(CONDICIONES, 'efectivo', null, 'ARS')).toBeNull();
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 12, 'ARS')).toContain('3, 6 cuotas');
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', null, 'ARS')).toContain('no existe');
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 3, 'ARS')).toContain('no ofrece');
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'efectivo', null, 'ARS')).toContain('no tiene descuento');
  });

  it('respeta el tope de cuotas de los productos', () => {
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 3, 'ARS', 3)).toBeNull();
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 6, 'ARS', 5)).toBe(
      'Con estos productos el máximo es 5 cuotas. Los que hay son de 3 cuotas.',
    );
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 3, 'ARS', 1)).toContain('no hay plan de cuotas');
    // El tope no toca el efectivo.
    expect(problemaDeFormaDePago(CONDICIONES, 'efectivo', null, 'ARS', 1)).toBeNull();
  });

  it('un pedido en dólares no va en cuotas', () => {
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 3, 'USD')).toContain('dólares');
    expect(problemaDeFormaDePago(CONDICIONES, 'efectivo', null, 'USD')).toBeNull();
  });
});
