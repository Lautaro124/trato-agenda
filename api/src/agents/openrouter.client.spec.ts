import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import {
  OpenRouterClient,
  OpenRouterError,
  OpenRouterTimeoutError,
  POLITICA_DE_PROVEEDOR,
} from './openrouter.client.js';

function crearCliente(overrides: Partial<Record<keyof Env, string>> = {}) {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: 'clave-de-prueba',
    OPENROUTER_MODEL: 'openai/gpt-4o-mini',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    ...overrides,
  };
  const config = {
    get: (clave: string) => valores[clave],
  } as unknown as ConfigService<Env, true>;

  return new OpenRouterClient(config);
}

function respuestaOk(cuerpo: unknown = { choices: [{ message: { content: 'ok' } }] }) {
  return new Response(JSON.stringify(cuerpo), { status: 200 });
}

function cuerpoEnviado(indice = 0): Record<string, unknown> {
  return JSON.parse(vi.mocked(fetch).mock.calls[indice][1]?.body as string) as Record<string, unknown>;
}

describe('OpenRouterClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falla sin llamar a fetch si no hay OPENROUTER_API_KEY', async () => {
    const client = crearCliente({ OPENROUTER_API_KEY: '' });

    await expect(client.chat({ messages: [{ role: 'user', content: 'hola' }] })).rejects.toThrow(
      OpenRouterError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('devuelve el primer choice en el camino feliz', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respuestaOk({ choices: [{ message: { content: 'hola de vuelta' } }] }),
    );

    const client = crearCliente();
    const resultado = await client.chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(resultado).toEqual({ content: 'hola de vuelta', tool_calls: undefined });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer clave-de-prueba');
    expect(cuerpoEnviado().model).toBe('openai/gpt-4o-mini');
  });

  it('usa OPENROUTER_BASE_URL para apuntar a otro endpoint compatible', async () => {
    vi.mocked(fetch).mockResolvedValue(respuestaOk());

    const client = crearCliente({ OPENROUTER_BASE_URL: 'http://openrouter-stub:4010/api/v1' });
    await client.chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://openrouter-stub:4010/api/v1/chat/completions');
  });

  it('manda reasoning sólo cuando se lo pasan', async () => {
    // Una Response nueva por llamada: el body se consume una sola vez.
    vi.mocked(fetch).mockImplementation(async () => respuestaOk());
    const client = crearCliente();

    await client.chat({ messages: [{ role: 'user', content: 'hola' }] });
    expect(cuerpoEnviado(0).reasoning).toBeUndefined();

    await client.chat({ messages: [{ role: 'user', content: 'hola' }], reasoning: { enabled: false } });
    expect(cuerpoEnviado(1).reasoning).toEqual({ enabled: false });
  });

  it('con jsonSchema pide structured outputs estricto y exige que el proveedor lo soporte', async () => {
    vi.mocked(fetch).mockResolvedValue(respuestaOk());
    const schema = { type: 'object', properties: { a: { type: 'string' } } };

    const client = crearCliente();
    await client.chat({
      messages: [{ role: 'user', content: 'hola' }],
      jsonMode: true,
      jsonSchema: { name: 'config_agente', schema },
      maxTokens: 3000,
    });

    const cuerpo = cuerpoEnviado();
    expect(cuerpo.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'config_agente', strict: true, schema },
    });
    expect(cuerpo.provider).toEqual({ ...POLITICA_DE_PROVEEDOR, require_parameters: true });
    expect(cuerpo.max_tokens).toBe(3000);
  });

  it('sin maxTokens ni jsonSchema no manda max_tokens ni require_parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(respuestaOk());

    await crearCliente().chat({ messages: [{ role: 'user', content: 'hola' }], jsonMode: true });

    const cuerpo = cuerpoEnviado();
    expect(cuerpo.response_format).toEqual({ type: 'json_object' });
    expect(cuerpo.max_tokens).toBeUndefined();
    // La política de datos va siempre; `require_parameters` sólo con jsonSchema.
    expect(cuerpo.provider).toEqual(POLITICA_DE_PROVEEDOR);
  });

  it('manda la política de no-entrenamiento / ZDR en toda llamada', async () => {
    vi.mocked(fetch).mockResolvedValue(respuestaOk());

    await crearCliente().chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(cuerpoEnviado().provider).toMatchObject({ data_collection: 'deny', zdr: true });
  });

  it('respeta timeoutMs y tira OpenRouterTimeoutError', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
          );
        }),
    );

    const client = crearCliente();
    const error = await client
      .chat({ messages: [{ role: 'user', content: 'hola' }], timeoutMs: 20 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OpenRouterTimeoutError);
    expect((error as Error).message).toContain('20ms');
  });

  it('devuelve usage cuando OpenRouter lo informa', async () => {
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 };
    vi.mocked(fetch).mockResolvedValue(respuestaOk({ choices: [{ message: { content: 'ok' } }], usage }));

    const resultado = await crearCliente().chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(resultado.usage).toEqual(usage);
  });

  it('propaga tool_calls cuando vienen en la respuesta', async () => {
    const toolCalls = [{ id: 'call_1', type: 'function' as const, function: { name: 'crear_turno', arguments: '{}' } }];
    vi.mocked(fetch).mockResolvedValue(
      respuestaOk({ choices: [{ message: { content: null, tool_calls: toolCalls } }] }),
    );

    const client = crearCliente();
    const resultado = await client.chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(resultado.tool_calls).toEqual(toolCalls);
  });

  it('lanza OpenRouterError (no de timeout) si la respuesta HTTP no es ok', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

    const client = crearCliente();
    const error = await client.chat({ messages: [{ role: 'user', content: 'hola' }] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error).not.toBeInstanceOf(OpenRouterTimeoutError);
  });

  it('lanza OpenRouterError si no hay ningún choice', async () => {
    vi.mocked(fetch).mockResolvedValue(respuestaOk({ choices: [] }));

    const client = crearCliente();

    await expect(client.chat({ messages: [{ role: 'user', content: 'hola' }] })).rejects.toThrow(
      OpenRouterError,
    );
  });
});
