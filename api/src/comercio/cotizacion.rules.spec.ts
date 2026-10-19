import { describe, expect, it } from 'vitest';
import {
  CONFIG_POR_DEFECTO,
  leerConfig,
  leerReceta,
  normalizarConfig,
  normalizarInsumo,
  normalizarReceta,
  type ConfigCotizacion,
  type Insumo,
  type Receta,
} from './costos.rules.js';
import { cotizar } from './cotizacion.rules.js';
import type { SolicitudADemanda } from './solicitud.rules.js';

const SOLICITUD: SolicitudADemanda = {
  preguntas: [
    { texto: 'Ancho (cm)', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true, numero: { variable: 'ancho', unidad: 'cm', min: 30, max: 300 } },
    { texto: 'Alto (cm)', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true, numero: { variable: 'alto', unidad: 'cm', min: 30, max: 300 } },
    { texto: '¿Con instalación?', sobre: 'solicita', opciones: ['Sí', 'No'], textoLibre: false, obligatoria: true },
  ],
};

const MELAMINA: Insumo = { id: 'i-mel', tipo: 'material', nombre: 'Melamina 18 mm', unidad: 'm2', costoCentavos: 2_000_000, activo: true };
const CORTE: Insumo = { id: 'i-cor', tipo: 'proceso', nombre: 'Corte CNC', unidad: 'hora', costoCentavos: 1_500_000, activo: true };
const CARPINTERO: Insumo = { id: 'i-car', tipo: 'mano_obra', nombre: 'Carpintero', unidad: 'hora', costoCentavos: 800_000, activo: true };
const INSUMOS = new Map([MELAMINA, CORTE, CARPINTERO].map((insumo) => [insumo.id, insumo]));

const RECETA: Receta = {
  renglones: [
    { insumoId: 'i-mel', cantidad: 'ancho × alto ÷ 10000 × 1,1' },
    { insumoId: 'i-cor', cantidad: '0,5' },
    { insumoId: 'i-car', cantidad: 'techo(ancho ÷ 100) × 2' },
  ],
  extras: [{ nombre: 'Instalación', modo: 'fijo', valor: 3_000_000, cuando: { pregunta: '¿Con instalación?', opcion: 'Sí' } }],
};

const respuestas = (ancho: string, alto: string, instalacion = 'No') => [
  { pregunta: 'Ancho (cm)', respuesta: ancho },
  { pregunta: 'Alto (cm)', respuesta: alto },
  { pregunta: '¿Con instalación?', respuesta: instalacion },
];

const cotizarCon = (config: ConfigCotizacion = CONFIG_POR_DEFECTO, r = respuestas('100', '200')) =>
  cotizar({ receta: RECETA, solicitud: SOLICITUD, insumos: INSUMOS, config, respuestas: r });

describe('cotizar', () => {
  it('cada renglón es cantidad × costo, en centavos enteros', () => {
    const resultado = cotizarCon();
    // 100 × 200 / 10000 × 1,1 = 2,2 m² × $ 20.000; 0,5 h × $ 15.000; techo(1) × 2 = 2 h × $ 8.000.
    expect(resultado).toEqual({
      ok: true,
      renglones: [
        { concepto: 'Melamina 18 mm', tipo: 'material', cantidad: 2.2, unidad: 'm²', precioUnitarioCentavos: 2_000_000, subtotalCentavos: 4_400_000 },
        { concepto: 'Corte CNC', tipo: 'proceso', cantidad: 0.5, unidad: 'h', precioUnitarioCentavos: 1_500_000, subtotalCentavos: 750_000 },
        { concepto: 'Carpintero', tipo: 'mano_obra', cantidad: 2, unidad: 'h', precioUnitarioCentavos: 800_000, subtotalCentavos: 1_600_000 },
      ],
      totalCentavos: 6_750_000,
      valores: { ancho: 100, alto: 200 },
    });
  });

  it('un extra con condición sólo entra con la opción elegida', () => {
    const con = cotizarCon(CONFIG_POR_DEFECTO, respuestas('100', '200', 'sí'));
    expect(con.ok && con.totalCentavos).toBe(9_750_000);
    expect(con.ok && con.renglones.at(-1)).toMatchObject({ concepto: 'Instalación', subtotalCentavos: 3_000_000 });
  });

  it('los porcentajes van en orden sobre lo acumulado, después los fijos generales y el redondeo para arriba', () => {
    const resultado = cotizarCon({
      ...CONFIG_POR_DEFECTO,
      extras: [
        { nombre: 'Ganancia', modo: 'porcentaje', valor: 40 },
        { nombre: 'IVA', modo: 'porcentaje', valor: 21 },
        { nombre: 'Flete', modo: 'fijo', valor: 500_000 },
      ],
      redondeoCentavos: 100_000,
    });
    if (!resultado.ok) throw new Error(resultado.motivo);
    const montos = Object.fromEntries(resultado.renglones.map((r) => [r.concepto, r.subtotalCentavos]));
    expect(montos['Ganancia (40 %)']).toBe(2_700_000);
    expect(montos['IVA (21 %)']).toBe(Math.round(9_450_000 * 0.21));
    expect(montos.Flete).toBe(500_000);
    expect(resultado.totalCentavos % 100_000).toBe(0);
    expect(resultado.renglones.reduce((suma, r) => suma + r.subtotalCentavos, 0)).toBe(resultado.totalCentavos);
  });

  it('no adivina: un dato sin contestar, un insumo que ya no está o una cuenta imposible no cotizan', () => {
    expect(cotizarCon(CONFIG_POR_DEFECTO, [{ pregunta: 'Alto (cm)', respuesta: '200' }])).toEqual({
      ok: false,
      motivo: 'Falta que el cliente conteste "Ancho (cm)" con un número.',
      faltan: ['Ancho (cm)'],
    });
    expect(cotizarCon(CONFIG_POR_DEFECTO, respuestas('mucho', '200'))).toMatchObject({ ok: false, faltan: ['Ancho (cm)'] });
    const sinCorte = new Map(INSUMOS);
    sinCorte.set('i-cor', { ...CORTE, activo: false });
    expect(cotizar({ receta: RECETA, solicitud: SOLICITUD, insumos: sinCorte, config: CONFIG_POR_DEFECTO, respuestas: respuestas('1', '1') })).toMatchObject({
      ok: false,
      motivo: expect.stringContaining('ya no está cargado'),
    });
    const division: Receta = { renglones: [{ insumoId: 'i-mel', cantidad: 'ancho ÷ (alto - 200)' }], extras: [] };
    expect(cotizar({ receta: division, solicitud: SOLICITUD, insumos: INSUMOS, config: CONFIG_POR_DEFECTO, respuestas: respuestas('100', '200') })).toMatchObject({
      ok: false,
    });
    expect(cotizar({ receta: null, solicitud: SOLICITUD, insumos: INSUMOS, config: CONFIG_POR_DEFECTO, respuestas: [] })).toMatchObject({
      ok: false,
      motivo: 'Este producto no tiene receta de cotización.',
    });
  });
});

describe('normalizarReceta', () => {
  it('valida fórmulas contra las preguntas de número y condiciones contra las opciones', () => {
    expect(normalizarReceta(RECETA, { solicitud: SOLICITUD, insumos: INSUMOS })).toEqual({ receta: RECETA });
    expect(normalizarReceta({ renglones: [{ insumoId: 'i-mel', cantidad: 'largo × 2' }] }, { solicitud: SOLICITUD, insumos: INSUMOS })).toEqual({
      error: 'Cantidad de "Melamina 18 mm": "largo" no es una pregunta de número de este producto.',
    });
    expect(normalizarReceta({ renglones: [{ insumoId: 'i-ajeno', cantidad: '1' }] }, { solicitud: SOLICITUD, insumos: INSUMOS })).toEqual({
      error: 'El renglón 1 usa algo que no está en tus materiales y costos.',
    });
    expect(
      normalizarReceta(
        { renglones: [], extras: [{ nombre: 'X', modo: 'fijo', valor: 100, cuando: { pregunta: '¿Con instalación?', opcion: 'Tal vez' } }] },
        { solicitud: SOLICITUD },
      ),
    ).toHaveProperty('error');
    expect(leerReceta({ renglones: 'roto' }, SOLICITUD)).toEqual({ renglones: [], extras: [] });
    expect(leerReceta(null, SOLICITUD)).toBeNull();
  });
});

describe('insumos y configuración', () => {
  it('normalizarInsumo', () => {
    expect(normalizarInsumo({ tipo: 'material', nombre: '  Melamina\n18 mm ', unidad: 'm2', costoCentavos: 2_000_000 })).toEqual({
      insumo: { tipo: 'material', nombre: 'Melamina 18 mm', unidad: 'm2', costoCentavos: 2_000_000 },
    });
    expect(normalizarInsumo({ tipo: 'otro', nombre: 'x', unidad: 'm2', costoCentavos: 1 })).toHaveProperty('error');
    expect(normalizarInsumo({ tipo: 'material', nombre: 'x', unidad: 'pie', costoCentavos: 1 })).toHaveProperty('error');
    expect(normalizarInsumo({ tipo: 'material', nombre: 'x', unidad: 'm2', costoCentavos: 0 })).toHaveProperty('error');
  });

  it('normalizarConfig: los generales no tienen cuentas ni condiciones, y lo roto vuelve a lo de siempre', () => {
    expect(normalizarConfig({ extras: [{ nombre: 'X', modo: 'formula', formula: '1' }] })).toHaveProperty('error');
    expect(normalizarConfig({ vigenciaDias: 0 })).toHaveProperty('error');
    expect(normalizarConfig({})).toEqual({ config: CONFIG_POR_DEFECTO });
    expect(leerConfig({ extras: 'roto', redondeoCentavos: 10_000, estimativo: false })).toMatchObject({ redondeoCentavos: 10_000, estimativo: false, extras: [] });
    expect(leerConfig(null)).toEqual(CONFIG_POR_DEFECTO);
  });
});
