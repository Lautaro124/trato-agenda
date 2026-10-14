import { describe, expect, it } from 'vitest';
import {
  leerModalidad,
  leerQueHace,
  MAX_QUE_HACE,
  MIN_QUE_HACE,
  normalizarQueHace,
  problemaDeModalidad,
} from './modalidad-venta.js';

const QUE_HACE = 'Hacemos muebles de madera a medida: mesas, bibliotecas y racks.';

describe('leerModalidad', () => {
  it('lee "pedido" tal cual', () => {
    expect(leerModalidad({ modalidadVenta: 'pedido' })).toBe('pedido');
  });

  it('cualquier otra cosa es "stock", el comportamiento de siempre', () => {
    expect(leerModalidad({ modalidadVenta: 'stock' })).toBe('stock');
    expect(leerModalidad({ modalidadVenta: 'otra' })).toBe('stock');
    expect(leerModalidad({ modalidadVenta: '' })).toBe('stock');
  });
});

describe('normalizarQueHace', () => {
  it('recorta las puntas y junta espacios y saltos de línea', () => {
    expect(normalizarQueHace('  Hacemos   mesas\n\ny sillas  ')).toBe('Hacemos mesas y sillas');
  });
});

describe('leerQueHace', () => {
  it('devuelve el texto normalizado', () => {
    expect(leerQueHace({ queHace: `  ${QUE_HACE}\n` })).toBe(QUE_HACE);
  });

  it('null si nunca lo cargó o es demasiado corto para servir', () => {
    expect(leerQueHace({ queHace: null })).toBeNull();
    expect(leerQueHace({ queHace: 'Mesas' })).toBeNull();
  });
});

describe('problemaDeModalidad', () => {
  it('a pedido exige saber qué hace el comercio', () => {
    expect(problemaDeModalidad('pedido', undefined)).toMatch(/al menos 30/);
    expect(problemaDeModalidad('pedido', 'x'.repeat(MIN_QUE_HACE - 1))).toMatch(/al menos/);
    expect(problemaDeModalidad('pedido', '   ' + 'x'.repeat(10) + '   ')).toMatch(/al menos/);
    expect(problemaDeModalidad('pedido', QUE_HACE)).toBeNull();
  });

  it('con stock es opcional', () => {
    expect(problemaDeModalidad('stock', undefined)).toBeNull();
    expect(problemaDeModalidad('stock', 'corto')).toBeNull();
  });

  it('en las dos modalidades acota el largo', () => {
    const largo = 'x'.repeat(MAX_QUE_HACE + 1);
    expect(problemaDeModalidad('pedido', largo)).toMatch(/600/);
    expect(problemaDeModalidad('stock', largo)).toMatch(/600/);
  });
});
