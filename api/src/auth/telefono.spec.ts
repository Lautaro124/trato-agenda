import { describe, expect, it } from 'vitest';
import { claveDeTelefono, normalizarTelefono, variantesDeTelefono } from './telefono.js';

describe('normalizarTelefono', () => {
  it('deja sólo los dígitos', () => {
    expect(normalizarTelefono('+54 9 11 2233-4455')).toBe('5491122334455');
    expect(normalizarTelefono('5491122334455')).toBe('5491122334455');
  });
});

describe('variantesDeTelefono', () => {
  it('encuentra el número argentino escrito con y sin el 9', () => {
    expect(variantesDeTelefono('5491122334455')).toContain('541122334455');
    expect(variantesDeTelefono('541122334455')).toContain('5491122334455');
  });

  it('pone primero el número tal cual se tipeó', () => {
    expect(variantesDeTelefono('+54 11 2233 4455')[0]).toBe('541122334455');
  });

  it('saca el 0 del código de área y el 15 del celular viejo', () => {
    expect(variantesDeTelefono('54 011 2233 4455')).toContain('5491122334455');
    expect(variantesDeTelefono('54 15 1122334455')).toContain('5491122334455');
  });

  it('hace lo mismo con el 1 de México', () => {
    expect(variantesDeTelefono('5215512345678')).toContain('525512345678');
    expect(variantesDeTelefono('525512345678')).toContain('5215512345678');
  });

  it('no inventa variantes para un país sin dígito de móvil', () => {
    expect(variantesDeTelefono('34600112233')).toEqual(['34600112233']);
  });
});

describe('claveDeTelefono', () => {
  it('colapsa todas las formas del mismo número en una sola clave', () => {
    const formas = ['5491122334455', '541122334455', '+54 9 11 2233-4455', '54 011 2233 4455'];
    const claves = new Set(formas.map(claveDeTelefono));
    expect(claves.size).toBe(1);
  });

  it('no mezcla dos números distintos', () => {
    expect(claveDeTelefono('5491122334455')).not.toBe(claveDeTelefono('5491122334456'));
  });
});

describe('variantesDeTelefono, límites', () => {
  it('no devuelve variantes fuera del rango que acepta el DTO', () => {
    for (const variante of variantesDeTelefono('549112233445566')) {
      expect(variante.length).toBeLessThanOrEqual(15);
    }
  });
});

describe('variantesDeTelefono, número nacional que empieza con 9', () => {
  it('prueba las dos lecturas del 9 cuando es ambiguo', () => {
    // 54 + 9 91234567: el 9 puede ser el de WhatsApp o el primer dígito del número.
    const variantes = variantesDeTelefono('54991234567');
    expect(variantes).toContain('54991234567');
    expect(variantes).toContain('549991234567');
  });
});
