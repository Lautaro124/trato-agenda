import { describe, expect, it } from 'vitest';
import {
  leerSolicitud,
  MAX_OPCIONES,
  MAX_PREGUNTAS,
  normalizarSolicitud,
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
  it('limpia espacios y deja primero lo que el cliente tiene, en el orden de carga', () => {
    const resultado = normalizarSolicitud({
      preguntas: [
        { ...COLOR, texto: '  ¿De qué   color la querés? ', opciones: [' Blanco ', 'Negro'] },
        MEDIDA,
        DETALLE,
      ],
    });
    expect(resultado).toEqual({
      solicitud: {
        preguntas: [MEDIDA, COLOR, DETALLE],
      },
    });
  });

  it('pide al menos una pregunta y pone un tope', () => {
    expect(error({ preguntas: [] })).toMatch(/al menos una pregunta/);
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

describe('leerSolicitud', () => {
  it('lee lo que se guardó', () => {
    const guardada = normalizarSolicitud({ preguntas: [MEDIDA, COLOR] });
    expect(leerSolicitud('solicitud' in guardada ? guardada.solicitud : null)).toEqual({ preguntas: [MEDIDA, COLOR] });
  });

  it('lo que no cierra vuelve como null, sin romper', () => {
    expect(leerSolicitud(null)).toBeNull();
    expect(leerSolicitud([])).toBeNull();
    expect(leerSolicitud({ preguntas: 'no' })).toBeNull();
    expect(leerSolicitud({ preguntas: [] })).toBeNull();
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
