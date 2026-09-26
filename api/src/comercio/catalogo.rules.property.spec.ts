/**
 * Property-based testing (fast-check) sobre catalogo.rules.ts. Misma semilla
 * fija que agenda-rules.property.spec.ts para que una falla sea reproducible.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  agruparFilasImportacion,
  consultaTsquery,
  formatearCentavos,
  fusionarRankings,
  hayStock,
  normalizarTexto,
  parsearPrecio,
  PRECIO_MAX_PESOS,
  unidadesDisponibles,
} from './catalogo.rules.js';

const SEMILLA = { seed: 42, numRuns: 200 };

describe('catalogo.rules (propiedades)', () => {
  it('normalizarTexto es idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (texto) => {
        const una = normalizarTexto(texto);
        expect(normalizarTexto(una)).toBe(una);
      }),
      SEMILLA,
    );
  });

  it('parsearPrecio lee lo que escribe formatearCentavos', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: PRECIO_MAX_PESOS * 100 }), (centavos) => {
        expect(parsearPrecio(formatearCentavos(centavos))).toBe(centavos);
      }),
      SEMILLA,
    );
  });

  it('consultaTsquery sólo deja palabras (con o sin prefijo) unidas por |', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (texto) => {
        const consulta = consultaTsquery(texto);
        if (consulta === null) return;
        expect(consulta).toMatch(/^[a-z0-9ñ]{2,}(:\*)?( \| [a-z0-9ñ]{2,}(:\*)?)*$/);
      }),
      SEMILLA,
    );
  });

  it('fusionarRankings devuelve ids únicos, de los rankings, hasta el límite', () => {
    const arbIds = fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { maxLength: 6 });
    fc.assert(
      fc.property(fc.array(arbIds, { maxLength: 4 }), fc.integer({ min: 0, max: 8 }), (listas, limite) => {
        const resultado = fusionarRankings(
          listas.map((ids) => ({ ids })),
          limite,
        );
        const todos = new Set(listas.flat());
        expect(new Set(resultado).size).toBe(resultado.length);
        expect(resultado.length).toBeLessThanOrEqual(limite);
        for (const id of resultado) expect(todos.has(id)).toBe(true);
      }),
      SEMILLA,
    );
  });

  it('nunca hay stock para más unidades de las que quedan', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (stock, reservadas, cantidad) => {
          const variante = { stock, disponible: true, activo: true };
          const unidades = unidadesDisponibles(variante, reservadas) as number;
          expect(hayStock(variante, cantidad, reservadas)).toBe(cantidad <= unidades);
          expect(unidades).toBeGreaterThanOrEqual(0);
        },
      ),
      SEMILLA,
    );
  });

  it('la importación nunca devuelve un producto que tuvo una fila con errores', () => {
    const arbFila = fc.record({
      codigo: fc.constantFrom('A', 'B', 'C', ''),
      nombre: fc.constantFrom('Remera', 'x', ''),
      variante: fc.constantFrom('', 'M', 'L'),
      precio: fc.constantFrom('100', '1.500,50', 'caro', ''),
      stock: fc.constantFrom('', '3', '-1'),
    });
    fc.assert(
      fc.property(fc.array(arbFila, { maxLength: 12 }), (filas) => {
        const { productos, errores } = agruparFilasImportacion(filas);
        const filasConError = new Set(errores.map((error) => error.fila));
        for (const producto of productos) {
          for (const fila of producto.filas) expect(filasConError.has(fila)).toBe(false);
          expect(new Set(producto.variantes.map((v) => v.sku)).size).toBe(producto.variantes.length);
        }
      }),
      SEMILLA,
    );
  });
});
