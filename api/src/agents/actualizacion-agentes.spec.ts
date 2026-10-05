import { describe, expect, it } from 'vitest';
import { ACCIONES_IDS, ACCIONES_VENTAS_IDS } from './agent-catalog.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import { PLANTILLA_VENTAS_VERSION, construirConfiguracionVentas } from './agent-template-ventas.js';
import { configuracionVigente, estaAlDia, tiposEventoValidos, type FilaAgente } from './actualizacion-agentes.js';
import { construirDescripcion } from './agents.service.js';

const AGENDA: FilaAgente = {
  tipoAsistente: 'agenda',
  tipoTitular: 'persona',
  nombreTitular: 'Dra. Ana',
  tipoUso: 'consultorio',
  tiposEvento: [{ nombre: 'Consulta', duracionMin: 30, precio: 15000 }],
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreBot: 'Tati',
  model: 'openai/gpt-4o-mini',
  templateVersion: null,
};

const VENTAS: FilaAgente = {
  ...AGENDA,
  tipoAsistente: 'ventas',
  tipoTitular: 'negocio',
  nombreTitular: 'Mates del Sur',
  tipoUso: 'comercio',
  tiposEvento: [],
  nombreBot: 'Sol',
  model: null,
  templateVersion: 2,
};

describe('estaAlDia', () => {
  it('sólo si viene de la plantilla vigente de su tipo', () => {
    expect(estaAlDia({ ...VENTAS, templateVersion: PLANTILLA_VENTAS_VERSION })).toBe(true);
    expect(estaAlDia({ ...AGENDA, model: null, templateVersion: PLANTILLA_VERSION })).toBe(true);
    expect(estaAlDia(VENTAS)).toBe(false);
    // El del meta-agente nunca está al día, aunque tuviera una versión cargada.
    expect(estaAlDia({ ...AGENDA, templateVersion: PLANTILLA_VERSION })).toBe(false);
  });
});

describe('configuracionVigente', () => {
  it('un agente de ventas viejo queda en la plantilla nueva, con ver_catalogo', () => {
    const resultado = configuracionVigente(VENTAS);
    expect(resultado).toEqual({
      ok: true,
      data: {
        ...construirConfiguracionVentas({ nombreTitular: 'Mates del Sur', nombreBot: 'Sol' }),
        descripcion: 'Negocio: Mates del Sur (ventas). El asistente se llama Sol.',
        model: null,
        templateVersion: PLANTILLA_VENTAS_VERSION,
      },
    });
    expect(resultado.ok && resultado.data.allowedActions).toEqual(ACCIONES_VENTAS_IDS);
    expect(resultado.ok && resultado.data.allowedActions).toContain('ver_catalogo');
  });

  it('uno de agenda del meta-agente sale igual que si se generara hoy con los mismos datos', () => {
    const dto = {
      tipoTitular: 'persona' as const,
      nombreTitular: 'Dra. Ana',
      tipoUso: 'consultorio' as const,
      tiposEvento: [{ nombre: 'Consulta', duracionMin: 30, precio: 15000 }],
      horaDesde: '09:00',
      horaHasta: '18:00',
      nombreBot: 'Tati',
    };
    expect(configuracionVigente(AGENDA)).toEqual({
      ok: true,
      data: {
        ...construirConfiguracion(dto),
        descripcion: construirDescripcion(dto),
        model: null,
        templateVersion: PLANTILLA_VERSION,
      },
    });
    const resultado = configuracionVigente(AGENDA);
    expect(resultado.ok && resultado.data.allowedActions).toEqual(ACCIONES_IDS);
  });

  it('sin tipos de turno o con otra forma no se regenera', () => {
    expect(configuracionVigente({ ...AGENDA, tiposEvento: [] })).toMatchObject({ ok: false });
    expect(configuracionVigente({ ...AGENDA, tiposEvento: ['Consulta'] })).toMatchObject({ ok: false });
    expect(configuracionVigente({ ...AGENDA, tiposEvento: { nombre: 'x' } })).toMatchObject({ ok: false });
  });

  it('sin nombres no se regenera', () => {
    expect(configuracionVigente({ ...VENTAS, nombreBot: '  ' })).toMatchObject({ ok: false });
  });
});

describe('tiposEventoValidos', () => {
  it('acepta el precio opcional y recorta los nombres', () => {
    expect(tiposEventoValidos([{ nombre: ' Consulta ', duracionMin: 30 }, { nombre: 'Control', duracionMin: 15, precio: 0 }])).toEqual([
      { nombre: 'Consulta', duracionMin: 30 },
      { nombre: 'Control', duracionMin: 15, precio: 0 },
    ]);
  });

  it('rechaza duraciones inválidas o precios que no son números', () => {
    expect(tiposEventoValidos([{ nombre: 'Consulta', duracionMin: '30' }])).toBeNull();
    expect(tiposEventoValidos([{ nombre: 'Consulta', duracionMin: 0 }])).toBeNull();
    expect(tiposEventoValidos([{ nombre: 'Consulta', duracionMin: 30, precio: '100' }])).toBeNull();
  });
});
