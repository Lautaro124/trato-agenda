import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { LinearClient, LinearError } from './linear.client.js';

const CONFIG: Partial<Env> = {
  LINEAR_API_KEY: 'lin_api_prueba',
  LINEAR_TEAM_ID: 'equipo-1',
  LINEAR_LABEL_ID: 'etiqueta-1',
  LINEAR_API_URL: 'https://linear.test/graphql',
};

function cliente(config: Partial<Env> = CONFIG): LinearClient {
  return new LinearClient({ get: (clave: keyof Env) => config[clave] ?? '' } as unknown as ConfigService<Env, true>);
}

function responder(cuerpo: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(cuerpo), { status }));
}

const ISSUE = { titulo: 'Sugerencia · Idea: hola"} mutation { x', descripcion: 'texto con "comillas" y {llaves}' };

describe('LinearClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('manda el texto como variables, nunca dentro de la query', async () => {
    const fetch = responder({ data: { issueCreate: { success: true, issue: { identifier: 'LAU-31' } } } });

    await expect(cliente().crearIssue(ISSUE)).resolves.toBe('LAU-31');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://linear.test/graphql');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('lin_api_prueba');
    const cuerpo = JSON.parse(String(init?.body)) as { query: string; variables: { input: Record<string, unknown> } };
    expect(cuerpo.query).not.toContain('hola');
    expect(cuerpo.query).not.toContain('comillas');
    expect(cuerpo.variables.input).toEqual({
      teamId: 'equipo-1',
      title: ISSUE.titulo,
      description: ISSUE.descripcion,
      labelIds: ['etiqueta-1'],
    });
  });

  it('sin etiqueta no manda labelIds', async () => {
    const fetch = responder({ data: { issueCreate: { success: true, issue: { identifier: 'LAU-31' } } } });
    await cliente({ ...CONFIG, LINEAR_LABEL_ID: '' }).crearIssue(ISSUE);
    const cuerpo = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as { variables: { input: Record<string, unknown> } };
    expect(cuerpo.variables.input).not.toHaveProperty('labelIds');
  });

  it('sin configurar falla sin llamar a Linear', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const sinKey = cliente({ ...CONFIG, LINEAR_API_KEY: '' });
    expect(sinKey.configurado()).toBe(false);
    await expect(sinKey.crearIssue(ISSUE)).rejects.toBeInstanceOf(LinearError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('los errores no repiten el cuerpo de la respuesta', async () => {
    responder({ errors: [{ message: `Argument invalid: ${ISSUE.descripcion}` }] });
    const error = (await cliente().crearIssue(ISSUE).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(LinearError);
    expect(error.message).toBe('Linear devolvió 1 error(es) de GraphQL.');

    responder({ message: ISSUE.descripcion }, 400);
    const http = (await cliente().crearIssue(ISSUE).catch((e: unknown) => e)) as Error;
    expect(http.message).toBe('Linear respondió 400.');
  });

  it('success false o sin identificador cuenta como fallo', async () => {
    responder({ data: { issueCreate: { success: false, issue: null } } });
    await expect(cliente().crearIssue(ISSUE)).rejects.toThrow('Linear no creó el issue.');
  });

  it('un corte de red se informa sin detalles', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed: secreto'));
    await expect(cliente().crearIssue(ISSUE)).rejects.toThrow('No se pudo llamar a Linear: TypeError.');
  });
});
