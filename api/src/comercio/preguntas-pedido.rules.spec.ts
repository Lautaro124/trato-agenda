import { describe, expect, it } from 'vitest';
import {
  describirPregunta,
  evaluarRespuestas,
  imagenesDePregunta,
  leerPreguntas,
  MAX_PREGUNTAS,
  normalizarPreguntas,
  preguntasSinHacer,
  textoDeNota,
  type PreguntaPedido,
  type RespuestasEvaluadas,
} from './preguntas-pedido.rules.js';

/** Lo que manda la web: el ejemplo de LAU-100 (tela → color) más una global de opciones y una de texto libre. */
function formulario(): Array<Record<string, unknown>> {
  return [
    {
      id: 'entrega',
      texto: '¿Para cuándo lo necesitás?',
      tipo: 'opciones',
      obligatoria: true,
      alcance: 'global',
      opciones: [
        { id: 'e1', texto: 'Esta semana' },
        { id: 'e2', texto: 'No tengo apuro' },
      ],
    },
    {
      id: 'tela',
      texto: '¿Qué tela querés?',
      tipo: 'opciones',
      obligatoria: true,
      alcance: 'producto',
      productos: ['sillon', 'puff'],
      imagenId: 'img-tela',
      opciones: [
        { id: 'lino', texto: 'Lino', imagenId: 'img-lino' },
        { id: 'pana', texto: 'Pana' },
        { id: 'cuero', texto: 'Cuero' },
      ],
    },
    {
      id: 'color',
      texto: '¿Qué color querés?',
      tipo: 'opciones',
      obligatoria: true,
      // La dependiente hereda el alcance y los productos de la anterior.
      alcance: 'global',
      dependeDe: { preguntaId: 'tela', siRespuestas: ['lino', 'pana'] },
      opciones: [
        { id: 'verde', texto: 'Verde', imagenId: 'img-verde', soloSi: ['lino'] },
        { id: 'rojo', texto: 'Rojo', imagenId: 'img-rojo', soloSi: ['lino'] },
        { id: 'gris', texto: 'Gris', imagenId: 'img-gris', soloSi: ['pana'] },
        { id: 'negro', texto: 'Negro', soloSi: [] },
      ],
      otra: { etiqueta: 'Personalizar' },
    },
    {
      id: 'aclaracion',
      texto: '¿Querés agregar algo más?',
      tipo: 'texto',
      obligatoria: false,
      alcance: 'global',
      ayuda: '  Ej.: es para regalo  ',
    },
  ];
}

function preguntas(): PreguntaPedido[] {
  const resultado = normalizarPreguntas(formulario());
  if ('error' in resultado) throw new Error(resultado.error);
  return resultado.preguntas;
}

const SILLON = { id: 'sillon', nombre: 'Sillón Nube' };
const PUFF = { id: 'puff', nombre: 'Puff Redondo' };
const MESA = { id: 'mesa', nombre: 'Mesa ratona' };

function evaluadas(resultado: RespuestasEvaluadas | { error: string }): RespuestasEvaluadas {
  if ('error' in resultado) throw new Error(resultado.error);
  return resultado;
}

describe('normalizarPreguntas', () => {
  it('limpia los textos y hace que la dependiente herede alcance y productos de la anterior', () => {
    const [entrega, , color, aclaracion] = preguntas();
    expect(entrega).toMatchObject({ alcance: 'global', productos: [], dependeDe: null, otra: null, ayuda: null });
    expect(color).toMatchObject({
      alcance: 'producto',
      productos: ['sillon', 'puff'],
      dependeDe: { preguntaId: 'tela', siRespuestas: ['lino', 'pana'] },
      otra: { etiqueta: 'Personalizar' },
    });
    expect(color.opciones[0]).toEqual({ id: 'verde', texto: 'Verde', imagenId: 'img-verde', soloSi: ['lino'] });
    expect(aclaracion).toMatchObject({ tipo: 'texto', ayuda: 'Ej.: es para regalo', opciones: [] });
  });

  describe('no pide documentos de identidad (LAU-106)', () => {
    const conDni = [
      { id: 'dni', texto: '¿Cuál es tu DNI?', tipo: 'texto', obligatoria: true, alcance: 'global' },
      {
        id: 'tipo',
        texto: '¿Qué tipo querés?',
        tipo: 'opciones',
        obligatoria: false,
        alcance: 'global',
        opciones: [{ id: 'a', texto: 'A' }],
      },
      {
        id: 'depende',
        texto: '¿Y el número?',
        tipo: 'texto',
        obligatoria: true,
        dependeDe: { preguntaId: 'dni', siRespuestas: [] },
      },
    ];

    it.each(['¿Cuál es tu DNI?', 'Pasame tu D.N.I.', 'Número de documento', 'Tu CUIL', '¿Pasaporte?'])(
      'rechaza al guardar la pregunta %j',
      (texto) => {
        const resultado = normalizarPreguntas([{ id: 'p', texto, tipo: 'texto', obligatoria: true, alcance: 'global' }]);
        expect(resultado).toEqual({ error: expect.stringContaining('documento de identidad') });
      },
    );

    it('rechaza una ayuda que lo pida', () => {
      const resultado = normalizarPreguntas([
        { id: 'p', texto: 'Datos', tipo: 'texto', ayuda: 'Ej.: tu DNI', obligatoria: false, alcance: 'global' },
      ]);
      expect(resultado).toEqual({ error: expect.stringContaining('documento de identidad') });
    });

    it('al leer lo guardado saca la pregunta del DNI y las que dependen de ella, y deja el resto', () => {
      expect(leerPreguntas(conDni).map((pregunta) => pregunta.id)).toEqual(['tipo']);
    });

    it('no confunde texto común con un documento', () => {
      const resultado = normalizarPreguntas([
        { id: 'p', texto: '¿Querés el verde ni el rojo? Es para redni', tipo: 'texto', obligatoria: false, alcance: 'global' },
      ]);
      expect(resultado).toMatchObject({ preguntas: [{ id: 'p' }] });
    });
  });

  it('acepta lista vacía o null como sin preguntas', () => {
    expect(normalizarPreguntas([])).toEqual({ preguntas: [] });
    expect(normalizarPreguntas(null)).toEqual({ preguntas: [] });
  });

  it.each([
    ['depender de una pregunta posterior', (f: Array<Record<string, unknown>>) => [f[2], f[1]], 'antes en la lista'],
    [
      'depender de una de texto libre',
      (f: Array<Record<string, unknown>>) => [f[3], { ...f[2], dependeDe: { preguntaId: 'aclaracion', siRespuestas: [] } }],
      'con opciones',
    ],
    [
      'una opción que vale para una opción inexistente de la anterior',
      (f: Array<Record<string, unknown>>) => [f[1], { ...f[2], opciones: [{ id: 'x', texto: 'Azul', soloSi: ['seda'] }] }],
      'ya no existe',
    ],
    [
      'ramas en una pregunta que no depende de otra',
      (f: Array<Record<string, unknown>>) => [{ ...f[0], opciones: [{ id: 'x', texto: 'Hoy', soloSi: ['e1'] }] }],
      'no depende de otra pregunta',
    ],
    [
      'una opción repetida dentro de la misma rama',
      (f: Array<Record<string, unknown>>) => [
        f[1],
        { ...f[2], opciones: [{ id: 'a', texto: 'Verde', soloSi: ['lino'] }, { id: 'b', texto: 'verde', soloSi: [] }] },
      ],
      'repetida',
    ],
    ['ids repetidos', (f: Array<Record<string, unknown>>) => [f[0], { ...f[3], id: 'entrega' }], 'id inválido'],
    ['una de producto sin productos', (f: Array<Record<string, unknown>>) => [{ ...f[1], productos: [] }], 'algún producto'],
    ['una de opciones sin opciones', (f: Array<Record<string, unknown>>) => [{ ...f[0], opciones: [] }], 'al menos una opción'],
  ])('rechaza %s', (_caso, armar, mensaje) => {
    const resultado = normalizarPreguntas(armar(formulario()));
    expect(resultado).toEqual({ error: expect.stringContaining(mensaje) });
  });

  it('una opción repetida en ramas distintas es válida', () => {
    const f = formulario();
    const resultado = normalizarPreguntas([
      f[1],
      { ...f[2], opciones: [{ id: 'a', texto: 'Verde', soloSi: ['lino'] }, { id: 'b', texto: 'Verde', soloSi: ['pana'] }] },
    ]);
    expect('error' in resultado).toBe(false);
  });

  it('aplica el tope de preguntas al guardar pero no al leer', () => {
    const muchas = Array.from({ length: MAX_PREGUNTAS + 1 }, (_, indice) => ({
      id: `p${indice}`,
      texto: `Pregunta ${indice}`,
      tipo: 'texto',
      alcance: 'global',
    }));
    expect(normalizarPreguntas(muchas)).toEqual({ error: expect.stringContaining(`${MAX_PREGUNTAS}`) });
    expect(leerPreguntas(muchas)).toHaveLength(MAX_PREGUNTAS + 1);
  });

  it('lo guardado dañado se lee como sin preguntas', () => {
    expect(leerPreguntas('no es una lista')).toEqual([]);
    expect(leerPreguntas([{ id: 'x' }])).toEqual([]);
  });
});

describe('evaluarRespuestas', () => {
  it('guarda las globales una vez por pedido y las de producto en su producto', () => {
    const resultado = evaluadas(
      evaluarRespuestas(preguntas(), [SILLON, MESA], [
        { preguntaId: 'entrega', respuesta: 'esta semana' },
        { preguntaId: 'tela', respuesta: 'Pana' },
        { preguntaId: 'color', respuesta: 'gris' },
      ]),
    );
    expect(resultado.globales).toEqual([{ pregunta: '¿Para cuándo lo necesitás?', respuesta: 'Esta semana' }]);
    expect(resultado.porProducto.get('sillon')).toEqual([
      { pregunta: '¿Qué tela querés?', respuesta: 'Pana' },
      { pregunta: '¿Qué color querés?', respuesta: 'Gris' },
    ]);
    // La mesa no tiene preguntas propias.
    expect(resultado.porProducto.get('mesa')).toEqual([]);
    expect(resultado.notas).toEqual([]);
  });

  it('con Lino sólo acepta los colores de Lino (y los de todas las ramas)', () => {
    const base = [
      { preguntaId: 'entrega', respuesta: 'No tengo apuro' },
      { preguntaId: 'tela', productoId: 'sillon', respuesta: 'Lino' },
    ];
    const gris = evaluarRespuestas(preguntas(), [SILLON], [...base, { preguntaId: 'color', respuesta: 'Gris' }]);
    expect(gris).toEqual({ error: expect.stringContaining('Las opciones son: Verde, Rojo, Negro') });
    expect(gris).toEqual({ error: expect.stringContaining('para "Lino"') });
    const negro = evaluadas(evaluarRespuestas(preguntas(), [SILLON], [...base, { preguntaId: 'color', respuesta: 'Negro' }]));
    expect(negro.porProducto.get('sillon')?.at(-1)).toEqual({ pregunta: '¿Qué color querés?', respuesta: 'Negro' });
  });

  it('un color fuera de la lista con "Personalizar" queda como nota con su contexto, no como opción', () => {
    const resultado = evaluadas(
      evaluarRespuestas(preguntas(), [SILLON], [
        { preguntaId: 'entrega', respuesta: 'Esta semana' },
        { preguntaId: 'tela', respuesta: 'Lino' },
        { preguntaId: 'color', respuesta: 'naranja' },
      ]),
    );
    expect(resultado.porProducto.get('sillon')).toEqual([{ pregunta: '¿Qué tela querés?', respuesta: 'Lino' }]);
    expect(resultado.notas).toEqual([
      {
        tipo: 'otra',
        pregunta: '¿Qué color querés?',
        respuesta: 'naranja',
        producto: 'Sillón Nube',
        contexto: [{ pregunta: '¿Qué tela querés?', respuesta: 'Lino' }],
      },
    ]);
    expect(textoDeNota(resultado.notas[0])).toBe(
      'Pedido especial en "¿Qué color querés?": naranja (¿Qué tela querés? Lino) · Sillón Nube',
    );
  });

  it('elegir la opción "Personalizar" sin decir qué quiere pide que lo describa', () => {
    const resultado = evaluarRespuestas(preguntas(), [SILLON], [
      { preguntaId: 'entrega', respuesta: 'Esta semana' },
      { preguntaId: 'tela', respuesta: 'Lino' },
      { preguntaId: 'color', respuesta: 'personalizar' },
    ]);
    expect(resultado).toEqual({ error: expect.stringContaining('pedile que te cuente qué quiere') });
  });

  it('sin "otra", una respuesta fuera de las opciones no se registra', () => {
    const resultado = evaluarRespuestas(preguntas(), [SILLON], [
      { preguntaId: 'entrega', respuesta: 'Esta semana' },
      { preguntaId: 'tela', respuesta: 'Seda' },
    ]);
    expect(resultado).toEqual({ error: expect.stringContaining('"Seda" no es una opción') });
  });

  it('si cambia la tela a una que no habilita colores, la respuesta vieja de color se ignora', () => {
    const resultado = evaluadas(
      evaluarRespuestas(preguntas(), [SILLON], [
        { preguntaId: 'entrega', respuesta: 'Esta semana' },
        { preguntaId: 'tela', respuesta: 'Cuero' },
        { preguntaId: 'color', respuesta: 'Verde' },
      ]),
    );
    expect(resultado.porProducto.get('sillon')).toEqual([{ pregunta: '¿Qué tela querés?', respuesta: 'Cuero' }]);
  });

  it('si cambia a otra tela con colores, el color de la tela anterior se vuelve a pedir', () => {
    const resultado = evaluarRespuestas(preguntas(), [SILLON], [
      { preguntaId: 'entrega', respuesta: 'Esta semana' },
      { preguntaId: 'tela', respuesta: 'Pana' },
      { preguntaId: 'color', respuesta: 'Verde' },
    ]);
    expect(resultado).toEqual({ error: expect.stringContaining('Las opciones son: Gris, Negro') });
  });

  it('exige las obligatorias activas, con las opciones de la rama', () => {
    const sinColor = evaluarRespuestas(preguntas(), [SILLON], [
      { preguntaId: 'entrega', respuesta: 'Esta semana' },
      { preguntaId: 'tela', respuesta: 'Lino' },
    ]);
    expect(sinColor).toEqual({ error: expect.stringContaining('Falta preguntarle al cliente "¿Qué color querés?" por "Sillón Nube" (opciones: Verde, Rojo, Negro)') });
    expect(evaluarRespuestas(preguntas(), [MESA], [])).toEqual({ error: expect.stringContaining('¿Para cuándo lo necesitás?') });
  });

  it('el texto libre va a las notas tal cual', () => {
    const resultado = evaluadas(
      evaluarRespuestas(preguntas(), [MESA], [
        { preguntaId: 'entrega', respuesta: 'Esta semana' },
        { preguntaId: 'aclaracion', respuesta: '  Es para regalo,   ¿lo envuelven? ' },
      ]),
    );
    expect(resultado.notas).toEqual([
      { tipo: 'texto', pregunta: '¿Querés agregar algo más?', respuesta: 'Es para regalo, ¿lo envuelven?', producto: null, contexto: [] },
    ]);
  });

  it('con dos productos que tienen la pregunta, cada respuesta va a su producto y sin productoId es ambigua', () => {
    const ambigua = evaluarRespuestas(preguntas(), [SILLON, PUFF], [
      { preguntaId: 'entrega', respuesta: 'Esta semana' },
      { preguntaId: 'tela', respuesta: 'Lino' },
    ]);
    expect(ambigua).toEqual({ error: expect.stringContaining('una respuesta por producto') });

    const resultado = evaluadas(
      evaluarRespuestas(preguntas(), [SILLON, PUFF], [
        { preguntaId: 'entrega', respuesta: 'Esta semana' },
        { preguntaId: 'tela', productoId: 'sillon', respuesta: 'Lino' },
        { preguntaId: 'color', productoId: 'sillon', respuesta: 'Rojo' },
        { preguntaId: 'tela', productoId: 'puff', respuesta: 'Cuero' },
      ]),
    );
    expect(resultado.porProducto.get('sillon')?.map((r) => r.respuesta)).toEqual(['Lino', 'Rojo']);
    expect(resultado.porProducto.get('puff')?.map((r) => r.respuesta)).toEqual(['Cuero']);
  });

  it('rechaza preguntas que no existen o productos que no las tienen', () => {
    expect(evaluarRespuestas(preguntas(), [MESA], [{ preguntaId: 'inventada', respuesta: 'x' }])).toEqual({
      error: expect.stringContaining('No existe la pregunta'),
    });
    expect(evaluarRespuestas(preguntas(), [MESA], [{ preguntaId: 'tela', productoId: 'mesa', respuesta: 'Lino' }])).toEqual({
      error: expect.stringContaining('no se le pregunta a "Mesa ratona"'),
    });
  });
});

describe('imagenesDePregunta', () => {
  it('manda la de la pregunta y las de sus opciones', () => {
    const todas = preguntas();
    expect(imagenesDePregunta(todas[1], todas, undefined)).toEqual({
      imagenes: [
        { imagenId: 'img-tela', leyenda: '¿Qué tela querés?' },
        { imagenId: 'img-lino', leyenda: 'Lino' },
      ],
    });
  });

  it('en una dependiente manda sólo las de la rama elegida', () => {
    const todas = preguntas();
    expect(imagenesDePregunta(todas[2], todas, 'lino')).toEqual({
      imagenes: [
        { imagenId: 'img-verde', leyenda: 'Verde' },
        { imagenId: 'img-rojo', leyenda: 'Rojo' },
      ],
    });
    expect(imagenesDePregunta(todas[2], todas, undefined)).toEqual({ error: expect.stringContaining('segun') });
    expect(imagenesDePregunta(todas[2], todas, 'Cuero')).toEqual({ error: expect.stringContaining('no se hace') });
  });
});

describe('describirPregunta', () => {
  it('le cuenta al modelo las ramas, la opción especial y las imágenes, con los textos como datos', () => {
    const todas = preguntas();
    const texto = describirPregunta(todas[2], todas);
    expect(texto).toContain('[pregunta color] "¿Qué color querés?"');
    expect(texto).toContain('sólo después de [pregunta tela] y sólo si eligió "Lino" / "Pana"');
    expect(texto).toContain('si "Lino": "Verde" / "Rojo" / "Negro"; si "Pana": "Gris" / "Negro"');
    expect(texto).toContain('"Personalizar"');
    expect(texto).toContain('enviar_imagenes_pregunta');
    expect(describirPregunta(todas[3], todas)).toContain('respuesta libre (ayuda para el cliente: "Ej.: es para regalo"); opcional');
  });
});

describe('preguntasSinHacer', () => {
  it('devuelve las de entrada que faltan hacer (globales y de los productos) y no las dependientes', () => {
    const faltan = preguntasSinHacer(preguntas(), ['sillon'], []);
    expect(faltan.map((pregunta) => pregunta.id)).toEqual(['entrega', 'aclaracion', 'tela']);
  });

  it('no repite las que el asistente ya hizo, aunque las reformule, ni las que ya vienen respondidas', () => {
    const dicho = ['¿Para cuándo lo necesitás? ¿Qué tela querés?'];
    expect(preguntasSinHacer(preguntas(), ['sillon'], dicho).map((p) => p.id)).toEqual(['aclaracion']);
    expect(preguntasSinHacer(preguntas(), ['sillon'], ['Para cuando lo necesitas, che'], new Set(['tela'])).map((p) => p.id)).toEqual([
      'aclaracion',
    ]);
  });

  it('las de producto sólo cuentan si ese producto está en el pedido', () => {
    expect(preguntasSinHacer(preguntas(), ['mesa'], []).map((pregunta) => pregunta.id)).toEqual(['entrega', 'aclaracion']);
  });
});
