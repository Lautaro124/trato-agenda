import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { describe, expect, it, vi } from 'vitest';
import {
  MARCA_SIN_CHOICES,
  clasificarFalloDelModelo,
  fetchQueRechazaRespuestasVacias,
} from './respuesta-sin-choices.js';

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

/** Lo que manda OpenRouter cuando la moderación del proveedor corta el pedido: 200 y sin choices. */
const CUERPO_MODERADO = {
  id: 'gen-1',
  error: {
    code: 403,
    message: 'Input flagged: texto del cliente',
    metadata: { reasons: ['violence'], flagged_input: 'texto del cliente', provider_name: 'Google AI Studio' },
  },
};

const RESPUESTA_OK = {
  id: 'gen-2',
  object: 'chat.completion',
  created: 0,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hola' }, finish_reason: 'stop' }],
};

function envolver(respuesta: Response) {
  return fetchQueRechazaRespuestasVacias(vi.fn(async () => respuesta) as unknown as typeof fetch);
}

describe('fetchQueRechazaRespuestasVacias', () => {
  it('un 200 sin choices con error.code pasa a ser ese status, con la marca', async () => {
    const respuesta = await envolver(respuestaJson(CUERPO_MODERADO))('https://x/chat/completions');

    expect(respuesta.status).toBe(403);
    expect(respuesta.headers.get(MARCA_SIN_CHOICES)).toBe('1');
    expect(await respuesta.json()).toEqual(CUERPO_MODERADO);
  });

  it('un 200 vacío sin código pasa a 502', async () => {
    const respuesta = await envolver(respuestaJson({ id: 'gen-3', choices: [] }))('https://x');

    expect(respuesta.status).toBe(502);
    expect(respuesta.headers.get(MARCA_SIN_CHOICES)).toBe('1');
  });

  it('un código fuera de 400-599 no se usa como status', async () => {
    const respuesta = await envolver(respuestaJson({ error: { code: 200 } }))('https://x');

    expect(respuesta.status).toBe(502);
  });

  it.each([
    ['con choices', respuestaJson(RESPUESTA_OK)],
    ['un error HTTP real', respuestaJson({ error: { code: 500 } }, 500)],
    ['algo que no es JSON', new Response('ok', { headers: { 'content-type': 'text/plain' } })],
    ['JSON inválido', new Response('{no', { headers: { 'content-type': 'application/json' } })],
  ])('deja intacta la respuesta %s', async (_caso, original) => {
    const respuesta = await envolver(original)('https://x');

    expect(respuesta).toBe(original);
  });
});

describe('clasificarFalloDelModelo', () => {
  it('un 403 es rechazo de contenido, con el proveedor y sin el texto', () => {
    const fallo = clasificarFalloDelModelo({
      status: 403,
      error: CUERPO_MODERADO.error,
      headers: new Headers({ [MARCA_SIN_CHOICES]: '1' }),
    });

    expect(fallo).toEqual({ motivo: 'rechazo_contenido', codigo: 403, proveedor: 'Google AI Studio' });
    expect(JSON.stringify(fallo)).not.toContain('texto del cliente');
  });

  it('metadata.reasons marca rechazo aunque el código no sea 403', () => {
    expect(clasificarFalloDelModelo({ status: 400, error: { metadata: { reasons: ['x'] } } }).motivo).toBe(
      'rechazo_contenido',
    );
  });

  it('un 200 vacío marcado con otro código es sin_respuesta', () => {
    const fallo = clasificarFalloDelModelo({ status: 502, error: {}, headers: new Headers({ [MARCA_SIN_CHOICES]: '1' }) });

    expect(fallo).toEqual({ motivo: 'sin_respuesta', codigo: 502 });
  });

  it('descarta un nombre de proveedor raro', () => {
    const fallo = clasificarFalloDelModelo({ status: 403, error: { metadata: { provider_name: 'x'.repeat(200) } } });

    expect(fallo.proveedor).toBeUndefined();
  });

  it.each([
    ['un 502 HTTP real', { status: 502, error: {}, headers: new Headers() }],
    ['un timeout', Object.assign(new Error('timeout'), { name: 'TimeoutError' })],
    ['un 401', { status: 401 }],
    ['un 403 HTTP real (key bloqueada)', { status: 403, error: { message: 'Key disabled' }, headers: new Headers() }],
    ['un 402 sin saldo aunque venga en un 200', { status: 402, error: {}, headers: new Headers({ [MARCA_SIN_CHOICES]: '1' }) }],
    ['algo que no es objeto', 'boom'],
  ])('%s es otro', (_caso, error) => {
    expect(clasificarFalloDelModelo(error).motivo).toBe('otro');
  });
});

describe('con ChatOpenAI de verdad (TRATO-API-2)', () => {
  function modelo(fetchDelCliente: typeof fetch) {
    return new ChatOpenAI({
      model: 'google/gemma-4-31b-it',
      apiKey: 'test',
      maxRetries: 0,
      configuration: { baseURL: 'https://openrouter.test/api/v1', fetch: fetchDelCliente },
    });
  }
  const fetchModerado = (async () => respuestaJson(CUERPO_MODERADO)) as unknown as typeof fetch;

  it('sin el wrapper, un 200 sin choices revienta con el TypeError que llegó a Sentry', async () => {
    await expect(modelo(fetchModerado).invoke([new HumanMessage('hola')])).rejects.toThrow(
      /reading 'message'/,
    );
  });

  it('con el wrapper llega un error con status que se clasifica como rechazo', async () => {
    const error = await modelo(fetchQueRechazaRespuestasVacias(fetchModerado))
      .invoke([new HumanMessage('hola')])
      .catch((e: unknown) => e);

    expect(clasificarFalloDelModelo(error)).toEqual({
      motivo: 'rechazo_contenido',
      codigo: 403,
      proveedor: 'Google AI Studio',
    });
  });

  it('con el wrapper una respuesta normal sigue funcionando', async () => {
    const fetchOk = (async () => respuestaJson(RESPUESTA_OK)) as unknown as typeof fetch;
    const respuesta = await modelo(fetchQueRechazaRespuestasVacias(fetchOk)).invoke([new HumanMessage('hola')]);

    expect(respuesta.content).toBe('hola');
  });
});
