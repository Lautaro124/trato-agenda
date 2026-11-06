import { describe, expect, it } from 'vitest';
import {
  MAX_PREGUNTAS_POR_PRODUCTO,
  normalizarPreguntas,
  validarRespuestas,
  type PreguntaProducto,
} from './preguntas-producto.rules.js';

const TALLE = { texto: ' ¿Qué  talle querés? ', tipo: 'opciones', opciones: ['S', ' M ', 'L', ''], obligatoria: true };
const NOMBRE = { texto: '¿Querés un nombre estampado?', tipo: 'texto', opciones: ['basura'], obligatoria: false };

function guardadas(): PreguntaProducto[] {
  const resultado = normalizarPreguntas([TALLE, NOMBRE]);
  if ('error' in resultado || !resultado.preguntas) throw new Error('fixture inválida');
  return resultado.preguntas;
}

describe('normalizarPreguntas', () => {
  it('limpia espacios, descarta opciones vacías y las opciones de una pregunta de texto', () => {
    expect(guardadas()).toEqual([
      { texto: '¿Qué talle querés?', tipo: 'opciones', opciones: ['S', 'M', 'L'], obligatoria: true },
      { texto: '¿Querés un nombre estampado?', tipo: 'texto', opciones: [], obligatoria: false },
    ]);
  });

  it('null, ausente o lista vacía no es ninguna pregunta', () => {
    for (const vacio of [null, undefined, []]) expect(normalizarPreguntas(vacio)).toEqual({ preguntas: null });
  });

  it.each([
    ['no es una lista', { texto: 'x' }],
    ['pregunta vacía', [{ ...NOMBRE, texto: '   ' }]],
    ['tipo inválido', [{ ...NOMBRE, tipo: 'multiple' }]],
    ['una sola opción', [{ ...TALLE, opciones: ['S'] }]],
    ['opciones repetidas sin importar mayúsculas', [{ ...TALLE, opciones: ['Rojo', 'rojo'] }]],
    ['preguntas repetidas', [NOMBRE, { ...NOMBRE, texto: '¿querés un NOMBRE estampado?' }]],
    ['demasiadas preguntas', Array.from({ length: MAX_PREGUNTAS_POR_PRODUCTO + 1 }, (_, i) => ({ ...NOMBRE, texto: `P${i}` }))],
    ['opción larguísima', [{ ...TALLE, opciones: ['S', 'x'.repeat(41)] }]],
  ])('rechaza: %s', (_motivo, entrada) => {
    expect(normalizarPreguntas(entrada)).toHaveProperty('error');
  });
});

describe('validarRespuestas', () => {
  const producto = { id: 'p1', nombre: 'Remera', preguntas: guardadas() };

  it('guarda la opción con el texto del dueño y la pregunta tal como está en la base', () => {
    const resultado = validarRespuestas(
      [producto],
      [
        { productoId: 'p1', pregunta: 1, respuesta: ' m ' },
        { productoId: 'p1', pregunta: 2, respuesta: 'Mateo' },
      ],
    );
    expect(resultado).toEqual({
      porProducto: new Map([
        [
          'p1',
          [
            { pregunta: '¿Qué talle querés?', respuesta: 'M' },
            { pregunta: '¿Querés un nombre estampado?', respuesta: 'Mateo' },
          ],
        ],
      ]),
    });
  });

  it('exige las obligatorias y deja saltear las opcionales', () => {
    expect(validarRespuestas([producto], [])).toEqual({ error: expect.stringContaining('¿Qué talle querés?') });
    expect(validarRespuestas([producto], [{ productoId: 'p1', pregunta: 1, respuesta: 'S' }])).toEqual({
      porProducto: new Map([['p1', [{ pregunta: '¿Qué talle querés?', respuesta: 'S' }]]]),
    });
  });

  it('rechaza una opción que no existe y lista las que hay', () => {
    expect(validarRespuestas([producto], [{ productoId: 'p1', pregunta: 1, respuesta: 'XXL' }])).toEqual({
      error: expect.stringContaining('S, M, L'),
    });
  });

  it('rechaza respuestas de un producto fuera del pedido o de una pregunta inexistente', () => {
    expect(validarRespuestas([producto], [{ productoId: 'otro', pregunta: 1, respuesta: 'S' }])).toHaveProperty('error');
    expect(validarRespuestas([producto], [{ productoId: 'p1', pregunta: 3, respuesta: 'S' }])).toHaveProperty('error');
  });

  it('un producto sin preguntas no pide nada', () => {
    expect(validarRespuestas([{ id: 'p2', nombre: 'Mate', preguntas: null }], [])).toEqual({
      porProducto: new Map([['p2', []]]),
    });
  });
});
