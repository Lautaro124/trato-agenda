import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLITICA_DE_PROVEEDOR } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';
import { DecisionesClient, DecisionesError, ordenDeLaRespuesta } from './decisiones.client.js';

function crearCliente(overrides: Partial<Record<keyof Env, string>> = {}) {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: 'clave-de-prueba',
    OPENROUTER_DECISIONS_URL: 'https://openrouter.ai/api/alpha/decisions',
    OPENROUTER_DECISIONS_MODEL: 'typesafe/jev-1.13',
    ...overrides,
  };
  const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
  return new DecisionesClient(config);
}

const PEDIDO = {
  estado: 'busco algo para tomar mate',
  instrucciones: 'Pick the category.',
  opciones: { c0: 'Category "Remeras"', c1: 'Category "Mates"', c2: 'Category "Termos"' },
  ninguna: 'No hint.',
};

function respuesta(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), { status });
}

describe('DecisionesClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda una pregunta choice con la opción none y la política ZDR, y ordena por probabilidad', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respuesta({
        answers: { interes: { type: 'choice', choice: 'c1', probabilities: { c0: 0.05, c1: 0.7, c2: 0.2, none: 0.05 } } },
      }),
    );

    await expect(crearCliente().ordenar(PEDIDO)).resolves.toEqual(['c1', 'c2', 'c0']);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const cuerpo = JSON.parse(String(init!.body));
    expect(cuerpo).toEqual({
      model: 'typesafe/jev-1.13',
      state: PEDIDO.estado,
      questions: {
        interes: {
          type: 'choice',
          instructions: PEDIDO.instrucciones,
          criteria: { ...PEDIDO.opciones, none: PEDIDO.ninguna },
        },
      },
      provider: POLITICA_DE_PROVEEDOR,
    });
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer clave-de-prueba');
  });

  it('sin opciones no llama a nadie', async () => {
    await expect(crearCliente().ordenar({ ...PEDIDO, opciones: {} })).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sin API key falla antes de llamar', async () => {
    const cliente = crearCliente({ OPENROUTER_API_KEY: '' });
    expect(cliente.configurado).toBe(false);
    await expect(cliente.ordenar(PEDIDO)).rejects.toBeInstanceOf(DecisionesError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un error HTTP no copia el cuerpo, que puede repetir lo que escribió el cliente', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":"busco algo para tomar mate"}', { status: 400 }));
    await expect(crearCliente().ordenar(PEDIDO)).rejects.toThrow(
      new DecisionesError('OpenRouter respondió 400 al pedir una decisión.'),
    );
  });

  it('rechaza "none" como opción propia y más opciones de las que admite Jev', async () => {
    await expect(crearCliente().ordenar({ ...PEDIDO, opciones: { none: 'x' } })).rejects.toBeInstanceOf(DecisionesError);
    const muchas = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`p${i}`, 'x']));
    await expect(crearCliente().ordenar({ ...PEDIDO, opciones: muchas })).rejects.toThrow('hasta 254');
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('decidir', () => {
    const PREGUNTAS = {
      compra: { tipo: 'noul', instrucciones: 'Will they buy?', si: 'Yes.', no: 'No.' },
      animo: { tipo: 'choice', instrucciones: 'Mood?', opciones: { bien: 'Good', mal: 'Bad' }, ninguna: 'Unknown' },
    } as const;

    it('manda varias preguntas en un pedido, con la política ZDR, y devuelve sólo lo legible', async () => {
      vi.mocked(fetch).mockResolvedValue(
        respuesta({
          answers: {
            compra: { type: 'noul', noul: 0.8 },
            animo: { type: 'choice', choice: 'bien', probabilities: { bien: 0.7, mal: 0.2, none: 0.1, inventada: 0.5 } },
          },
        }),
      );

      await expect(crearCliente().decidir('Customer: hola', PREGUNTAS)).resolves.toEqual({
        compra: 0.8,
        animo: { bien: 0.7, mal: 0.2, none: 0.1 },
      });

      const cuerpo = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
      expect(cuerpo).toEqual({
        model: 'typesafe/jev-1.13',
        state: 'Customer: hola',
        questions: {
          compra: { type: 'noul', instructions: 'Will they buy?', criteria: { true: 'Yes.', false: 'No.' } },
          animo: { type: 'choice', instructions: 'Mood?', criteria: { bien: 'Good', mal: 'Bad', none: 'Unknown' } },
        },
        provider: POLITICA_DE_PROVEEDOR,
      });
    });

    it('descarta probabilidades fuera de 0 a 1 o que no son números', async () => {
      vi.mocked(fetch).mockResolvedValue(
        respuesta({ answers: { compra: { noul: 1.5 }, animo: { probabilities: { bien: '0.9', mal: -1 } } } }),
      );
      await expect(crearCliente().decidir('x', PREGUNTAS)).resolves.toEqual({});
    });

    it('sin preguntas no llama, y con "none" como opción falla antes de llamar', async () => {
      await expect(crearCliente().decidir('x', {})).resolves.toEqual({});
      await expect(
        crearCliente().decidir('x', { a: { tipo: 'choice', instrucciones: 'x', opciones: { none: 'x' }, ninguna: 'x' } }),
      ).rejects.toBeInstanceOf(DecisionesError);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe('ordenDeLaRespuesta', () => {
  const ids = ['c0', 'c1', 'c2'];

  it('ignora probabilidades de ids que no se mandaron', () => {
    expect(ordenDeLaRespuesta({ answers: { interes: { probabilities: { c2: 0.5, inventada: 0.9 } } } }, ids)).toEqual([
      'c2',
      'c0',
      'c1',
    ]);
  });

  it('sin probabilidades usa la ganadora', () => {
    expect(ordenDeLaRespuesta({ answers: { interes: { choice: 'c1' } } }, ids)).toEqual(['c1', 'c0', 'c2']);
  });

  it('si ganó none, deja el orden como estaba', () => {
    expect(ordenDeLaRespuesta({ answers: { interes: { choice: 'none' } } }, ids)).toEqual(ids);
  });

  it('una respuesta sin nada reconocible es un error', () => {
    expect(() => ordenDeLaRespuesta({}, ids)).toThrow(DecisionesError);
  });
});
