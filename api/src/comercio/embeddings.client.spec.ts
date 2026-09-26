import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLITICA_DE_PROVEEDOR } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';
import {
  DIMENSIONES_EMBEDDING,
  EmbeddingsClient,
  EmbeddingsError,
  literalVector,
  MAX_TEXTOS_POR_PEDIDO,
} from './embeddings.client.js';

function crearCliente(overrides: Partial<Record<keyof Env, string>> = {}) {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: 'clave-de-prueba',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_EMBEDDINGS_MODEL: 'openai/text-embedding-3-small',
    ...overrides,
  };
  const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
  return new EmbeddingsClient(config);
}

const vector = (valor: number) => Array.from({ length: DIMENSIONES_EMBEDDING }, () => valor);

function respuesta(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), { status });
}

describe('EmbeddingsClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda el modelo, los textos y la política ZDR, y ordena por index', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respuesta({
        data: [
          { index: 1, embedding: vector(0.2) },
          { index: 0, embedding: vector(0.1) },
        ],
      }),
    );

    const vectores = await crearCliente().embeber(['mate', 'bombilla']);

    expect(vectores.map((v) => v[0])).toEqual([0.1, 0.2]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['mate', 'bombilla'],
      encoding_format: 'float',
      provider: POLITICA_DE_PROVEEDOR,
    });
  });

  it('no llama a la red sin textos', async () => {
    await expect(crearCliente().embeber([])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falla claro sin OPENROUTER_API_KEY', async () => {
    const cliente = crearCliente({ OPENROUTER_API_KEY: '' });
    expect(cliente.configurado).toBe(false);
    await expect(cliente.embeber(['x'])).rejects.toBeInstanceOf(EmbeddingsError);
  });

  it('rechaza lotes más grandes que el tope', async () => {
    const textos = Array.from({ length: MAX_TEXTOS_POR_PEDIDO + 1 }, () => 'x');
    await expect(crearCliente().embeber(textos)).rejects.toBeInstanceOf(EmbeddingsError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no loguea el cuerpo del error (puede repetir el texto del cliente)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('texto secreto del cliente', { status: 500 }));
    await expect(crearCliente().embeber(['x'])).rejects.toThrow('OpenRouter respondió 500 al pedir embeddings.');
  });

  it('rechaza una respuesta con otra dimensión o cantidad', async () => {
    vi.mocked(fetch).mockResolvedValue(respuesta({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    await expect(crearCliente().embeber(['x'])).rejects.toBeInstanceOf(EmbeddingsError);

    vi.mocked(fetch).mockResolvedValue(respuesta({ data: [] }));
    await expect(crearCliente().embeber(['x'])).rejects.toBeInstanceOf(EmbeddingsError);
  });

  it('arma el literal de pgvector', () => {
    expect(literalVector([0.5, -1, 2])).toBe('[0.5,-1,2]');
  });
});
