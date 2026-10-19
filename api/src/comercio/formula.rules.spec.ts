import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcularFormula, evaluarFormula, LARGO_MAX_FORMULA, parsearFormula } from './formula.rules.js';

const VARIABLES = new Set(['ancho', 'alto', 'cantidad']);
const valores = { ancho: 120, alto: 240, cantidad: 2 };

const calcular = (texto: string) => {
  const parseo = parsearFormula(texto, VARIABLES);
  if (!parseo.ok) return parseo;
  return evaluarFormula(parseo.ast, valores);
};

describe('parsearFormula + evaluarFormula', () => {
  it('cuentas como las escribe el dueño: coma decimal, × y ÷, precedencia y paréntesis', () => {
    expect(calcular('ancho × alto ÷ 10000')).toEqual({ ok: true, valor: 2.88 });
    expect(calcular('ancho * alto / 10000 * 1,1')).toMatchObject({ ok: true });
    expect(calcular('2 + 3 * 4')).toEqual({ ok: true, valor: 14 });
    expect(calcular('(2 + 3) * 4')).toEqual({ ok: true, valor: 20 });
    expect(calcular('-ancho + 200')).toEqual({ ok: true, valor: 80 });
    expect(calcular('ANCHO / 100')).toEqual({ ok: true, valor: 1.2 });
  });

  it('funciones con ";" entre valores', () => {
    expect(calcular('techo(ancho / 50)')).toEqual({ ok: true, valor: 3 });
    expect(calcular('redondear(2,5)')).toEqual({ ok: true, valor: 3 });
    expect(calcular('max(ancho; alto; 10)')).toEqual({ ok: true, valor: 240 });
    expect(calcular('min(cantidad; 1)')).toEqual({ ok: true, valor: 1 });
  });

  it('devuelve qué variables usa', () => {
    expect(parsearFormula('ancho * alto + 3', VARIABLES)).toMatchObject({ ok: true, variables: ['ancho', 'alto'] });
  });

  it('rechaza con un motivo legible lo que no es una fórmula', () => {
    expect(parsearFormula('', VARIABLES)).toEqual({ ok: false, error: 'La fórmula está vacía.' });
    expect(parsearFormula('largo * 2', VARIABLES)).toEqual({
      ok: false,
      error: '"largo" no es una pregunta de número de este producto.',
    });
    expect(parsearFormula('ancho * (alto', VARIABLES)).toEqual({ ok: false, error: 'Falta cerrar un paréntesis.' });
    expect(parsearFormula('ancho alto', VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula('ancho *', VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula('techo(1; 2)', VARIABLES)).toEqual({ ok: false, error: 'techo lleva 1 valor.' });
    expect(parsearFormula('techo', VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula('process.exit(1)', VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula('ancho; alto', VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula('1 % 2', VARIABLES)).toEqual({ ok: false, error: 'No entiendo "%" en la fórmula (posición 3).' });
    expect(parsearFormula('1'.repeat(LARGO_MAX_FORMULA + 1), VARIABLES)).toMatchObject({ ok: false });
    expect(parsearFormula(`${'('.repeat(30)}1${')'.repeat(30)}`, VARIABLES)).toMatchObject({ ok: false });
  });

  it('nada del prototipo cuenta como variable o función', () => {
    for (const nombre of ['constructor', '__proto__', 'tostring', 'hasownproperty']) {
      expect(parsearFormula(`${nombre} + 1`, VARIABLES)).toMatchObject({ ok: false });
      expect(parsearFormula(`${nombre}(1)`, VARIABLES)).toMatchObject({ ok: false });
    }
  });

  it('una división por cero o un dato que falta es un error, nunca un número inventado', () => {
    expect(calcular('ancho / (alto - 240)')).toEqual({ ok: false, error: 'La cuenta divide por cero.' });
    const parseo = parsearFormula('ancho * 2', VARIABLES);
    expect(parseo.ok && evaluarFormula(parseo.ast, {})).toEqual({ ok: false, error: 'Falta el dato "ancho".' });
    expect(calcularFormula('ancho * 2', { ancho: Number.NaN })).toMatchObject({ ok: false });
  });

  it('nunca lanza, escriba lo que escriba el dueño', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 250 }), (texto) => {
        const parseo = parsearFormula(texto, VARIABLES);
        if (parseo.ok) expect(() => evaluarFormula(parseo.ast, valores)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });

  it('con texto armado de piezas válidas tampoco lanza ni deja variables desconocidas', () => {
    const pieza = fc.constantFrom('ancho', 'alto', 'largo', '1', '2,5', '+', '-', '×', '÷', '(', ')', ';', 'techo(', 'max(', ' ');
    fc.assert(
      fc.property(fc.array(pieza, { maxLength: 40 }), (piezas) => {
        const parseo = parsearFormula(piezas.join(''), VARIABLES);
        if (parseo.ok) {
          expect(parseo.variables.every((variable) => VARIABLES.has(variable))).toBe(true);
          expect(() => evaluarFormula(parseo.ast, valores)).not.toThrow();
        }
      }),
      { numRuns: 2000 },
    );
  });
});
