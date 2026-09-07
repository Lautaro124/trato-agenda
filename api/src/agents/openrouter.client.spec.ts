import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { OpenRouterClient, OpenRouterError } from './openrouter.client.js';

function crearCliente(overrides: Partial<Record<keyof Env, string>> = {}) {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: 'clave-de-prueba',
    OPENROUTER_MODEL: 'openai/gpt-4o-mini',
    ...overrides,
  };
  const config = {
    get: (clave: string) => valores[clave],
  } as unknown as ConfigService<Env, true>;

  return new OpenRouterClient(config);
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
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'hola de vuelta' } }] }),
        { status: 200 },
      ),
    );

    const client = crearCliente();
    const resultado = await client.chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(resultado).toEqual({ content: 'hola de vuelta', tool_calls: undefined });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer clave-de-prueba');
    expect(JSON.parse(init?.body as string).model).toBe('openai/gpt-4o-mini');
  });

  it('manda reasoning sólo cuando se lo pasan', async () => {
    // Una Response nueva por llamada: el body se consume una sola vez.
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    );
    const client = crearCliente();

    await client.chat({ messages: [{ role: 'user', content: 'hola' }] });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).reasoning).toBeUndefined();

    await client.chat({ messages: [{ role: 'user', content: 'hola' }], reasoning: { enabled: false } });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string).reasoning).toEqual({
      enabled: false,
    });
  });

  it('propaga tool_calls cuando vienen en la respuesta', async () => {
    const toolCalls = [{ id: 'call_1', type: 'function' as const, function: { name: 'crear_turno', arguments: '{}' } }];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: toolCalls } }] }), {
        status: 200,
      }),
    );

    const client = crearCliente();
    const resultado = await client.chat({ messages: [{ role: 'user', content: 'hola' }] });

    expect(resultado.tool_calls).toEqual(toolCalls);
  });

  it('lanza OpenRouterError si la respuesta HTTP no es ok', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

    const client = crearCliente();

    await expect(client.chat({ messages: [{ role: 'user', content: 'hola' }] })).rejects.toThrow(
      OpenRouterError,
    );
  });

  it('lanza OpenRouterError si no hay ningún choice', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    const client = crearCliente();

    await expect(client.chat({ messages: [{ role: 'user', content: 'hola' }] })).rejects.toThrow(
      OpenRouterError,
    );
  });
});
