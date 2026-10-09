import { describe, expect, it } from 'vitest';
import {
  alcanceDe,
  aplicaA,
  descuentoVigente,
  detalleParaElModelo,
  diaDeDesde,
  diaDeHasta,
  etiquetaDescuento,
  finDeVigencia,
  inicioDeVigencia,
  mejorDescuento,
  montoDeDescuento,
  problemaDeDescuento,
  type DescuentoParaAplicar,
} from './descuentos.rules.js';

const AHORA = new Date('2026-10-15T15:00:00-03:00');
const MATE = { id: 'p-mate', categoria: 'Mates' };

function descuento(datos: Partial<DescuentoParaAplicar>): DescuentoParaAplicar {
  return {
    id: 'd1',
    productoId: null,
    categoria: null,
    nombre: '',
    tipo: 'porcentaje',
    valor: 10,
    activo: true,
    desde: null,
    hasta: null,
    ...datos,
  };
}

describe('vigencia', () => {
  it('vale desde el primer instante de `desde` hasta antes de `hasta`', () => {
    const desde = inicioDeVigencia('2026-10-15');
    const hasta = finDeVigencia('2026-10-31');
    expect(desde).toEqual(new Date('2026-10-15T00:00:00-03:00'));
    expect(hasta).toEqual(new Date('2026-11-01T00:00:00-03:00'));
    const d = descuento({ desde, hasta });
    expect(descuentoVigente(d, new Date(desde.getTime() - 1))).toBe(false);
    expect(descuentoVigente(d, desde)).toBe(true);
    expect(descuentoVigente(d, new Date(hasta.getTime() - 1))).toBe(true);
    expect(descuentoVigente(d, hasta)).toBe(false);
  });

  it('sin fechas vale siempre, pausado nunca', () => {
    expect(descuentoVigente(descuento({}), AHORA)).toBe(true);
    expect(descuentoVigente(descuento({ activo: false }), AHORA)).toBe(false);
  });

  it('las fechas vuelven al mismo día que se cargó', () => {
    expect(diaDeDesde(inicioDeVigencia('2026-10-15'))).toBe('2026-10-15');
    expect(diaDeHasta(finDeVigencia('2026-10-31'))).toBe('2026-10-31');
    expect(diaDeHasta(null)).toBeNull();
  });
});

describe('alcance', () => {
  it('sale de productoId y categoria', () => {
    expect(alcanceDe({ productoId: 'p', categoria: null })).toBe('producto');
    expect(alcanceDe({ productoId: null, categoria: 'Mates' })).toBe('categoria');
    expect(alcanceDe({ productoId: null, categoria: null })).toBe('catalogo');
  });

  it('compara la categoría sin mayúsculas ni tildes', () => {
    expect(aplicaA({ productoId: null, categoria: 'mates' }, MATE)).toBe(true);
    expect(aplicaA({ productoId: null, categoria: 'Infusión' }, { id: 'x', categoria: 'infusion' })).toBe(true);
    expect(aplicaA({ productoId: null, categoria: 'Yerbas' }, MATE)).toBe(false);
    expect(aplicaA({ productoId: null, categoria: 'Yerbas' }, { id: 'x', categoria: null })).toBe(false);
    expect(aplicaA({ productoId: 'otro', categoria: null }, MATE)).toBe(false);
    expect(aplicaA({ productoId: null, categoria: null }, MATE)).toBe(true);
  });
});

describe('montoDeDescuento', () => {
  it('porcentaje redondeado al centavo', () => {
    expect(montoDeDescuento({ tipo: 'porcentaje', valor: 20 }, 1_000_000)).toBe(200_000);
    expect(montoDeDescuento({ tipo: 'porcentaje', valor: 15 }, 999)).toBe(150);
  });

  it('monto fijo, salvo que deje el precio en cero o menos', () => {
    expect(montoDeDescuento({ tipo: 'monto', valor: 50_000 }, 1_000_000)).toBe(50_000);
    expect(montoDeDescuento({ tipo: 'monto', valor: 1_000_000 }, 1_000_000)).toBe(0);
    expect(montoDeDescuento({ tipo: 'monto', valor: 2_000_000 }, 1_000_000)).toBe(0);
  });

  it('un tipo desconocido o un precio en cero no descuentan', () => {
    expect(montoDeDescuento({ tipo: 'regalo', valor: 10 }, 1_000)).toBe(0);
    expect(montoDeDescuento({ tipo: 'porcentaje', valor: 10 }, 0)).toBe(0);
  });
});

describe('mejorDescuento', () => {
  it('sin descuentos que le toquen, null', () => {
    expect(mejorDescuento([], MATE, 1_000_000, AHORA)).toBeNull();
    expect(mejorDescuento([descuento({ categoria: 'Yerbas' })], MATE, 1_000_000, AHORA)).toBeNull();
    expect(mejorDescuento([descuento({ activo: false })], MATE, 1_000_000, AHORA)).toBeNull();
  });

  it('aplica el que más le conviene al cliente y no los suma', () => {
    const delProducto = descuento({ id: 'a', productoId: 'p-mate', valor: 20 });
    const deCatalogo = descuento({ id: 'b', tipo: 'monto', valor: 50_000, nombre: 'Primera compra' });
    const resultado = mejorDescuento([deCatalogo, delProducto], MATE, 1_000_000, AHORA);
    expect(resultado).toMatchObject({
      descuentoId: 'a',
      alcance: 'producto',
      precioListaCentavos: 1_000_000,
      descuentoCentavos: 200_000,
      precioFinalCentavos: 800_000,
      etiqueta: '20% off',
    });

    // Con un precio más bajo, el monto fijo pasa a ser el mejor.
    expect(mejorDescuento([deCatalogo, delProducto], MATE, 200_000, AHORA)).toMatchObject({
      descuentoId: 'b',
      precioFinalCentavos: 150_000,
      nombre: 'Primera compra',
    });
  });

  it('a igual monto gana el más específico', () => {
    const deCatalogo = descuento({ id: 'a', valor: 10 });
    const deCategoria = descuento({ id: 'b', categoria: 'Mates', valor: 10 });
    const delProducto = descuento({ id: 'c', productoId: 'p-mate', valor: 10 });
    expect(mejorDescuento([deCatalogo, deCategoria], MATE, 100_000, AHORA)?.descuentoId).toBe('b');
    expect(mejorDescuento([deCatalogo, deCategoria, delProducto], MATE, 100_000, AHORA)?.descuentoId).toBe('c');
  });

  it('ignora los vencidos y los que todavía no empezaron', () => {
    const vencido = descuento({ id: 'a', valor: 50, hasta: inicioDeVigencia('2026-10-15') });
    const futuro = descuento({ id: 'b', valor: 40, desde: inicioDeVigencia('2026-10-16') });
    const vigente = descuento({ id: 'c', valor: 5 });
    expect(mejorDescuento([vencido, futuro, vigente], MATE, 100_000, AHORA)?.descuentoId).toBe('c');
  });
});

describe('textos', () => {
  it('etiqueta y detalle para el modelo', () => {
    expect(etiquetaDescuento({ tipo: 'porcentaje', valor: 20 })).toBe('20% off');
    expect(etiquetaDescuento({ tipo: 'monto', valor: 50_000 })).toBe('$ 500 off');
    const aplicado = mejorDescuento(
      [descuento({ nombre: 'Semana del mate', hasta: finDeVigencia('2026-10-31') })],
      MATE,
      100_000,
      AHORA,
    );
    expect(aplicado && detalleParaElModelo(aplicado)).toBe('10% off hasta el 31/10, promo "Semana del mate"');
  });
});

describe('problemaDeDescuento', () => {
  it.each([
    [{ tipo: 'porcentaje', valor: 0 }, 'mayor que cero'],
    [{ tipo: 'porcentaje', valor: 91 }, 'de 1 a 90'],
    [{ tipo: 'monto', valor: 1.5 }, 'mayor que cero'],
    [{ tipo: 'regalo', valor: 10 }, 'porcentaje o monto'],
    [{ tipo: 'monto', valor: 100, desde: '2026-10-20', hasta: '2026-10-10' }, 'anterior'],
    [{ tipo: 'monto', valor: 100, desde: '2026-13-45' }, 'no existe'],
    [{ tipo: 'monto', valor: 100, hasta: '2026-02-31' }, 'no existe'],
  ])('rechaza %o', (datos, mensaje) => {
    expect(problemaDeDescuento(datos)).toContain(mensaje);
  });

  it('acepta un porcentaje o un monto válidos, con o sin fechas', () => {
    expect(problemaDeDescuento({ tipo: 'porcentaje', valor: 90 })).toBeNull();
    expect(problemaDeDescuento({ tipo: 'monto', valor: 100, desde: '2026-10-10', hasta: '2026-10-10' })).toBeNull();
  });
});
