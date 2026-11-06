import { describe, expect, it } from 'vitest';
import {
  cuotasEnComun,
  describirCuotas,
  descuentoEfectivo,
  filaDeCobroManual,
  leerCondiciones,
  leerCuotasProducto,
  normalizarCobroManual,
  normalizarCondiciones,
  normalizarCuotasProducto,
  problemaDeFormaDePago,
  recargoDeRenglon,
  SIN_CONDICIONES,
  valorDeCuota,
  type CondicionesPago,
  type CuotasProducto,
} from './condiciones-pago.rules.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';

const CONDICIONES: CondicionesPago = { descuentoEfectivoPorcentaje: 10, cobroManual: null };

const SIN_INTERES: CuotasProducto = { modo: 'recargo', recargoPorcentaje: 0, planes: [3, 6] };
const CON_PRECIOS: CuotasProducto = {
  modo: 'precios',
  planes: [
    { cuotas: 3, totalCentavos: 110_000 },
    { cuotas: 12, totalCentavos: 150_000 },
  ],
};

describe('normalizarCondiciones', () => {
  it.each([
    [{ descuentoEfectivoPorcentaje: 0 }, 'efectivo'],
    [{ descuentoEfectivoPorcentaje: 91 }, 'efectivo'],
  ])('rechaza %j', (entrada, motivo) => {
    const resultado = normalizarCondiciones(entrada);
    expect('error' in resultado && resultado.error).toContain(motivo);
  });
});

describe('leerCondiciones', () => {
  it('sin fila o con una rota no ofrece nada', () => {
    expect(leerCondiciones(null)).toEqual(SIN_CONDICIONES);
    expect(leerCondiciones({ descuentoEfectivoPorcentaje: 500 })).toEqual(SIN_CONDICIONES);
  });
});

describe('cuotas de un producto', () => {
  it('con recargo: ordena las cantidades y deja sólo los campos del modo', () => {
    expect(
      normalizarCuotasProducto({ modo: 'recargo', recargoPorcentaje: 10, planes: [12, 3], totalCentavos: 1 }, 100_000, 'ARS'),
    ).toEqual({ cuotas: { modo: 'recargo', recargoPorcentaje: 10, planes: [3, 12] } });
  });

  it('con precio por plan: ordena por cantidad', () => {
    expect(
      normalizarCuotasProducto({ modo: 'precios', planes: [...CON_PRECIOS.planes].reverse() }, 100_000, 'ARS'),
    ).toEqual({ cuotas: CON_PRECIOS });
  });

  it('null o ausente es en un pago', () => {
    expect(normalizarCuotasProducto(null, 100_000, 'ARS')).toEqual({ cuotas: null });
    expect(normalizarCuotasProducto(undefined, 100_000, 'USD')).toEqual({ cuotas: null });
  });

  it.each([
    [{ modo: 'otro', planes: [3] }, 'no son válidas'],
    [{ modo: 'recargo', recargoPorcentaje: 0, planes: [] }, 'Elegí en cuántas'],
    [{ modo: 'recargo', recargoPorcentaje: 0, planes: [1] }, 'de 2 a 24'],
    [{ modo: 'recargo', recargoPorcentaje: 0, planes: [25] }, 'de 2 a 24'],
    [{ modo: 'recargo', recargoPorcentaje: 0, planes: [3.5] }, 'de 2 a 24'],
    [{ modo: 'recargo', recargoPorcentaje: 0, planes: [3, 3] }, 'dos planes'],
    [{ modo: 'recargo', recargoPorcentaje: -1, planes: [3] }, 'recargo'],
    [{ modo: 'recargo', recargoPorcentaje: 101, planes: [3] }, 'recargo'],
    [{ modo: 'precios', planes: [{ cuotas: 3 }] }, 'Falta el total'],
    [{ modo: 'precios', planes: [{ cuotas: 3, totalCentavos: 99_999 }] }, 'menor que el precio'],
    [{ modo: 'precios', planes: [3] }, 'no son válidas'],
  ])('rechaza %j', (entrada, motivo) => {
    const resultado = normalizarCuotasProducto(entrada, 100_000, 'ARS');
    expect('error' in resultado && resultado.error).toContain(motivo);
  });

  it('un producto en dólares no va en cuotas', () => {
    const resultado = normalizarCuotasProducto(SIN_INTERES, 100_000, 'USD');
    expect('error' in resultado && resultado.error).toContain('dólares');
    expect(leerCuotasProducto(SIN_INTERES, 100_000, 'USD')).toBeNull();
  });

  it('al leer, un total que quedó por debajo del precio deja de ofrecerse', () => {
    expect(leerCuotasProducto(CON_PRECIOS, 120_000, 'ARS')).toEqual({
      modo: 'precios',
      planes: [{ cuotas: 12, totalCentavos: 150_000 }],
    });
    expect(leerCuotasProducto(CON_PRECIOS, 200_000, 'ARS')).toBeNull();
    expect(leerCuotasProducto({ modo: 'recargo', planes: 'x' }, 100_000, 'ARS')).toBeNull();
    expect(leerCuotasProducto(null, 100_000, 'ARS')).toBeNull();
  });

  it('se describe para el asistente', () => {
    expect(describirCuotas(SIN_INTERES)).toBe('3 o 6 cuotas sin interés');
    expect(describirCuotas({ modo: 'recargo', recargoPorcentaje: 15, planes: [3, 6, 12] })).toBe(
      '3, 6 o 12 cuotas con 15% de recargo',
    );
    expect(describirCuotas(CON_PRECIOS)).toBe('3 cuotas: total $ 1.100; 12 cuotas: total $ 1.500');
  });
});

describe('montos', () => {
  it('con recargo, es un porcentaje del subtotal del renglón, redondeado al centavo', () => {
    const quince: CuotasProducto = { modo: 'recargo', recargoPorcentaje: 15, planes: [6] };
    expect(recargoDeRenglon(quince, 6, { cantidad: 2, subtotalCentavos: 1_000_000 })).toBe(150_000);
    expect(recargoDeRenglon(quince, 6, { cantidad: 1, subtotalCentavos: 333 })).toBe(50);
    expect(recargoDeRenglon(SIN_INTERES, 3, { cantidad: 1, subtotalCentavos: 1_000_000 })).toBe(0);
  });

  it('con precio por plan, es lo que va del subtotal (con promos) al total del plan por unidad', () => {
    expect(recargoDeRenglon(CON_PRECIOS, 3, { cantidad: 2, subtotalCentavos: 200_000 })).toBe(20_000);
    expect(recargoDeRenglon(CON_PRECIOS, 12, { cantidad: 1, subtotalCentavos: 80_000 })).toBe(70_000);
  });

  it('las cuotas redondean para arriba: nunca cubren menos que el total', () => {
    expect(valorDeCuota(1_000_000, 3)).toBe(333_334);
    expect(valorDeCuota(1_000_000, 3) * 3).toBeGreaterThanOrEqual(1_000_000);
  });

  it('un pedido sólo va en las cuotas que tienen todos sus productos', () => {
    expect(cuotasEnComun([SIN_INTERES, CON_PRECIOS])).toEqual([3]);
    expect(cuotasEnComun([SIN_INTERES])).toEqual([3, 6]);
    expect(cuotasEnComun([SIN_INTERES, null])).toEqual([]);
    expect(cuotasEnComun([])).toEqual([]);
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
    const fila = { descuentoEfectivoPorcentaje: 10, ...filaDeCobroManual(cobro) };
    expect(fila.mensajeCobroManual).toBeNull();
    expect(leerCondiciones(fila).cobroManual).toEqual(cobro);
  });

  it('uno roto queda como coordinar por el chat sin llevarse el efectivo', () => {
    const fila = {
      descuentoEfectivoPorcentaje: 10,
      cobroManual: 'transferencia',
      aliasTransferencia: null,
      titularTransferencia: null,
      mensajeCobroManual: null,
    };
    expect(leerCondiciones(fila)).toEqual({ ...SIN_CONDICIONES, descuentoEfectivoPorcentaje: 10 });
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
    expect(problemaDeFormaDePago(SIN_CONDICIONES, null, null, 'ARS', [null])).toBeNull();
  });

  it('el efectivo sólo con descuento configurado', () => {
    expect(problemaDeFormaDePago(CONDICIONES, 'efectivo', null, 'ARS', [null])).toBeNull();
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'efectivo', null, 'ARS', [null])).toContain('no tiene descuento');
    // Las cuotas de los productos no tocan el efectivo.
    expect(problemaDeFormaDePago(CONDICIONES, 'efectivo', null, 'USD', [null])).toBeNull();
  });

  it('las cuotas, sólo las que tienen todos los productos', () => {
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 6, 'ARS', [SIN_INTERES])).toBeNull();
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 3, 'ARS', [SIN_INTERES, CON_PRECIOS])).toBeNull();
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 6, 'ARS', [SIN_INTERES, CON_PRECIOS])).toBe(
      'Con estos productos no hay plan de 6 cuotas. Los que hay son de 3 cuotas.',
    );
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', null, 'ARS', [SIN_INTERES])).toContain('3, 6 cuotas');
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 3, 'ARS', [null])).toContain('se vende en un pago');
    expect(problemaDeFormaDePago(SIN_CONDICIONES, 'cuotas', 3, 'ARS', [SIN_INTERES, null])).toContain('en común');
  });

  it('un pedido en dólares no va en cuotas', () => {
    expect(problemaDeFormaDePago(CONDICIONES, 'cuotas', 3, 'USD', [SIN_INTERES])).toContain('dólares');
  });
});
