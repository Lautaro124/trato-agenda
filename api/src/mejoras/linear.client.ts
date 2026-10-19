import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const TIMEOUT_MS = 10_000;

/**
 * La query es fija: el título y el texto viajan siempre como variables de
 * GraphQL, nunca pegados adentro, así una sugerencia no puede cambiar qué
 * operación se ejecuta.
 */
const CREAR_ISSUE = `mutation CrearSugerencia($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier } }
}`;

/** No está configurada, no respondió o no creó el issue. El mensaje nunca trae el cuerpo de la respuesta. */
export class LinearError extends Error {}

export type IssueNuevo = { titulo: string; descripcion: string };

/**
 * Wrapper delgado sobre la API GraphQL de Linear, con la misma forma que
 * `agents/openrouter.client.ts`: `fetch` directo, sin SDK. Sólo crea issues.
 */
@Injectable()
export class LinearClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  configurado(): boolean {
    return Boolean(this.config.get('LINEAR_API_KEY', { infer: true }) && this.config.get('LINEAR_TEAM_ID', { infer: true }));
  }

  /** Crea el issue y devuelve su identificador (ej. "LAU-31"). */
  async crearIssue(issue: IssueNuevo): Promise<string> {
    const apiKey = this.config.get('LINEAR_API_KEY', { infer: true });
    const teamId = this.config.get('LINEAR_TEAM_ID', { infer: true });
    if (!apiKey || !teamId) throw new LinearError('LINEAR_API_KEY o LINEAR_TEAM_ID no están configuradas.');
    const labelId = this.config.get('LINEAR_LABEL_ID', { infer: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.config.get('LINEAR_API_URL', { infer: true }), {
        method: 'POST',
        signal: controller.signal,
        // Las API keys personales de Linear van sin "Bearer".
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: CREAR_ISSUE,
          variables: {
            input: {
              teamId,
              title: issue.titulo,
              description: issue.descripcion,
              ...(labelId ? { labelIds: [labelId] } : {}),
            },
          },
        }),
      });

      // Sin el cuerpo: un error de validación de Linear puede repetir el texto
      // de la sugerencia, y este mensaje termina en los logs.
      if (!res.ok) throw new LinearError(`Linear respondió ${res.status}.`);

      const data = (await res.json()) as {
        data?: { issueCreate?: { success?: boolean; issue?: { identifier?: unknown } | null } | null } | null;
        errors?: unknown[];
      };
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        throw new LinearError(`Linear devolvió ${data.errors.length} error(es) de GraphQL.`);
      }
      const identificador = data.data?.issueCreate?.issue?.identifier;
      if (!data.data?.issueCreate?.success || typeof identificador !== 'string' || !identificador) {
        throw new LinearError('Linear no creó el issue.');
      }
      return identificador.slice(0, 40);
    } catch (error) {
      if (error instanceof LinearError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LinearError(`Linear no respondió en ${TIMEOUT_MS}ms.`);
      }
      throw new LinearError(`No se pudo llamar a Linear: ${error instanceof Error ? error.name : 'error desconocido'}.`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
