import { describe, expect, it } from 'vitest';
import {
  leerSolicitud,
  MAX_OPCIONES,
  MAX_MATERIALES,
  MAX_PREGUNTAS,
  normalizarMateriales,
  normalizarSolicitud,
  problemaSegunModalidad,
  validarRespuestasSolicitud,
  type SolicitudADemanda,
} from './solicitud.rules.js';

const MEDIDA = {
  texto: '¿Qué medida tiene la ventana?',
  sobre: 'tiene',
  opciones: ['Chica', 'Mediana', 'Grande'],
  textoLibre: true,
  obligatoria: true,
};
const COLOR = {
  texto: '¿De qué color la querés?',
  sobre: 'solicita',
  opciones: ['Blanco', 'Negro'],
  textoLibre: false,
  obligatoria: true,
};
const DETALLE = { texto: '¿Algo más que tengamos que saber?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: false };

function error(entrada: Parameters<typeof normalizarSolicitud>[0]): string {
  const resultado = normalizarSolicitud(entrada);
  if (!('error' in resultado)) throw new Error('se esperaba un error');
  return resultado.error;
}

describe('normalizarSolicitud', () => {
  it('limpia espacios y respeta el orden de carga', () => {
    const resultado = normalizarSolicitud({
      preguntas: [
        { ...COLOR, texto: '  ¿De qué   color la querés? ', opciones: [' Blanco ', 'Negro'] },
        MEDIDA,
        DETALLE,
      ],
    });
    expect(resultado).toEqual({
      solicitud: {
        preguntas: [COLOR, MEDIDA, DETALLE],
      },
    });
  });

  it('las preguntas son opcionales y sin "sobre" son de lo que el cliente pide', () => {
    expect(normalizarSolicitud({ preguntas: [] })).toEqual({ solicitud: { preguntas: [] } });
    const { sobre: _sobre, ...sinSobre } = DETALLE;
    expect(normalizarSolicitud({ preguntas: [sinSobre] })).toEqual({ solicitud: { preguntas: [DETALLE] } });
  });

  it('pone un tope de preguntas', () => {
    const muchas = Array.from({ length: MAX_PREGUNTAS + 1 }, (_, i) => ({ ...DETALLE, texto: `Pregunta ${i}` }));
    expect(error({ preguntas: muchas })).toMatch(/hasta 15 preguntas/);
  });

  it('rechaza una pregunta vacía, repetida o sin tipo', () => {
    expect(error({ preguntas: [{ ...DETALLE, texto: '  ' }] })).toBe('Escribí la pregunta 1.');
    expect(error({ preguntas: [MEDIDA, { ...DETALLE, texto: '¿que MEDIDA tiene la ventana' }] })).toMatch(/repetida/);
    expect(error({ preguntas: [{ ...DETALLE, sobre: 'otra' }] })).toMatch(/lo que tiene o lo que pide/);
  });

  it('rechaza opciones vacías, repetidas o de más', () => {
    expect(error({ preguntas: [{ ...COLOR, opciones: ['Blanco', ' '] }] })).toMatch(/opción vacía/);
    expect(error({ preguntas: [{ ...COLOR, opciones: ['Blanco', 'blanco'] }] })).toMatch(/"blanco" repetida/);
    const muchas = Array.from({ length: MAX_OPCIONES + 1 }, (_, i) => `Opción ${i}`);
    expect(error({ preguntas: [{ ...COLOR, opciones: muchas }] })).toMatch(/más de 12 opciones/);
  });

  it('rechaza las contradictorias: sin opciones ni texto libre, o una sola opción para elegir', () => {
    expect(error({ preguntas: [{ ...COLOR, opciones: [] }] })).toMatch(/no tiene opciones/);
    expect(error({ preguntas: [{ ...COLOR, opciones: ['Blanco'] }] })).toMatch(/una sola opción/);
    // Con texto libre, una sola opción es una sugerencia válida.
    expect(normalizarSolicitud({ preguntas: [{ ...COLOR, opciones: ['Blanco'], textoLibre: true }] })).toHaveProperty(
      'solicitud',
    );
  });
});

describe('normalizarMateriales', () => {
  it('limpia, saca vacíos y repetidos sin tildes ni mayúsculas, y respeta el orden', () => {
    expect(normalizarMateriales([' Melamina ', 'MDF   laqueado', '', 'melamína', 'Madera'])).toEqual({
      materiales: ['Melamina', 'MDF laqueado', 'Madera'],
    });
    expect(normalizarMateriales([])).toEqual({ materiales: [] });
  });

  it('pone un tope de cantidad y de largo', () => {
    const muchos = Array.from({ length: MAX_MATERIALES + 1 }, (_, i) => `Material ${i}`);
    expect(normalizarMateriales(muchos)).toEqual({ error: `Un producto puede tener hasta ${MAX_MATERIALES} materiales.` });
    expect(normalizarMateriales(['x'.repeat(61)])).toHaveProperty('error');
  });
});

describe('leerSolicitud', () => {
  it('lee lo que se guardó', () => {
    const guardada = normalizarSolicitud({ preguntas: [MEDIDA, COLOR] });
    expect(leerSolicitud('solicitud' in guardada ? guardada.solicitud : null)).toEqual({ preguntas: [MEDIDA, COLOR] });
  });

  it('lo que no cierra vuelve como null, sin romper', () => {
    expect(leerSolicitud(null)).toBeNull();
    expect(leerSolicitud([])).toBeNull();
    expect(leerSolicitud({ preguntas: 'no' })).toBeNull();
    // Sin preguntas sigue siendo a medida: el asistente pregunta lo básico.
    expect(leerSolicitud({ preguntas: [] })).toEqual({ preguntas: [] });
    expect(leerSolicitud({ preguntas: [{ ...COLOR, opciones: [] }] })).toBeNull();
    // Un ítem roto se descarta y el resto se lee.
    expect(leerSolicitud({ preguntas: [42, { ...MEDIDA, opciones: ['Chica', 3, 'Mediana', 'Grande'] }] })).toEqual({
      preguntas: [MEDIDA],
    });
  });
});

describe('validarRespuestasSolicitud', () => {
  const config = (normalizarSolicitud({ preguntas: [MEDIDA, COLOR, DETALLE] }) as { solicitud: SolicitudADemanda })
    .solicitud;

  it('está completa con las obligatorias; empareja sin tildes y usa la opción como la cargó el dueño', () => {
    expect(
      validarRespuestasSolicitud(config, [
        { pregunta: 'que medida tiene la ventana', respuesta: '1,20 x 1,50' },
        { pregunta: '¿De qué color la querés?', respuesta: 'negro' },
        { pregunta: 'Otra cosa', respuesta: 'se descarta' },
      ]),
    ).toEqual({
      ok: true,
      respuestas: [
        { pregunta: '¿Qué medida tiene la ventana?', respuesta: '1,20 x 1,50' },
        { pregunta: '¿De qué color la querés?', respuesta: 'Negro' },
      ],
    });
  });

  it('no está completa si falta una obligatoria o la respuesta no es una de las opciones', () => {
    const resultado = validarRespuestasSolicitud(config, [
      { pregunta: '¿De qué color la querés?', respuesta: 'Violeta' },
      { pregunta: '¿Algo más que tengamos que saber?', respuesta: 'Es para un baño' },
    ]);
    expect(resultado).toEqual({
      ok: false,
      motivo:
        'La solicitud todavía no está completa: faltan "¿Qué medida tiene la ventana?"; ' +
        '"¿De qué color la querés?" sólo admite "Blanco", "Negro".',
      faltantes: ['¿Qué medida tiene la ventana?', '¿De qué color la querés?'],
    });
  });

  it('una respuesta vacía cuenta como no contestada', () => {
    const resultado = validarRespuestasSolicitud(config, [
      { pregunta: '¿Qué medida tiene la ventana?', respuesta: '   ' },
      { pregunta: '¿De qué color la querés?', respuesta: 'Blanco' },
    ]);
    expect(resultado).toMatchObject({ ok: false, faltantes: ['¿Qué medida tiene la ventana?'] });
    expect(validarRespuestasSolicitud(config, 'basura')).toMatchObject({ ok: false });
  });
});

describe('problemaSegunModalidad', () => {
  const preguntas = { preguntas: [DETALLE] };

  it('con stock: precio obligatorio, sin preguntas ni precio de referencia', () => {
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: undefined, solicitud: undefined, precioReferencia: undefined })).toBeNull();
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: null, solicitud: null, precioReferencia: null })).toBeNull();
    expect(problemaSegunModalidad('stock', { variantes: 0, descuento: undefined, solicitud: undefined, precioReferencia: undefined })).toMatch(/precio/);
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: undefined, solicitud: preguntas, precioReferencia: undefined })).toMatch(/vende con stock/);
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: undefined, solicitud: undefined, precioReferencia: 100 })).toMatch(/vende con stock/);
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: undefined, solicitud: undefined, precioReferencia: undefined, materiales: ['Madera'] })).toMatch(/vende con stock/);
    expect(problemaSegunModalidad('stock', { variantes: 1, descuento: undefined, solicitud: undefined, precioReferencia: undefined, materiales: [] })).toBeNull();
  });

  it('a pedido: la solicitud viene (puede no tener preguntas), sin variantes ni descuento; el precio "desde" es opcional', () => {
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: undefined, solicitud: { preguntas: [] }, precioReferencia: null, materiales: ['Madera'] })).toBeNull();
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: undefined, solicitud: preguntas, precioReferencia: null })).toBeNull();
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: null, solicitud: preguntas, precioReferencia: 100 })).toBeNull();
    expect(problemaSegunModalidad('pedido', { variantes: 1, descuento: undefined, solicitud: preguntas, precioReferencia: null })).toMatch(/variantes/);
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: { tipo: 'porcentaje' }, solicitud: preguntas, precioReferencia: null })).toMatch(/descuento/);
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: undefined, solicitud: null, precioReferencia: null })).toMatch(/preguntas/);
    expect(problemaSegunModalidad('pedido', { variantes: 0, descuento: undefined, solicitud: undefined, precioReferencia: null })).toMatch(/preguntas/);
  });
});
