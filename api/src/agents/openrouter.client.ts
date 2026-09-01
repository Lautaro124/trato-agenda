import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 20_000;

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionMessage = {
  content: string | null;
  tool_calls?: ToolCall[];
};

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Pide JSON estructurado. Sin tools, típicamente usado por el meta-agente. */
  jsonMode?: boolean;
  /** Override puntual del modelo; por defecto usa OPENROUTER_MODEL. */
  model?: string;
};

/** Se lanza cuando OpenRouter no está configurado o la llamada falla. */
export class OpenRouterError extends Error {}

/**
 * Wrapper delgado sobre el endpoint de chat completions de OpenRouter (API
 * compatible con OpenAI). Sin SDK: es un `fetch` directo, coherente con que
 * el resto de `api/` no trae dependencias pesadas. Lo usan tanto el
 * meta-agente (api/src/agents, sin tools, con jsonMode) como el runtime
 * conversacional (api/src/conversation, con tools, sin jsonMode).
 */
@Injectable()
export class OpenRouterClient {
  private readonly logger = new Logger(OpenRouterClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async chat(options: ChatOptions): Promise<ChatCompletionMessage> {
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) {
      throw new OpenRouterError(
        'OPENROUTER_API_KEY no está configurada. Definila en api/.env (ver README).',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato Agenda',
        },
        body: JSON.stringify({
          model: options.model ?? this.config.get('OPENROUTER_MODEL', { infer: true }),
          messages: options.messages,
          ...(options.tools ? { tools: options.tools, tool_choice: 'auto' } : {}),
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!res.ok) {
        const cuerpo = await res.text().catch(() => '');
        throw new OpenRouterError(
          `OpenRouter respondió ${res.status}: ${cuerpo.slice(0, 500)}`,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: ChatCompletionMessage }>;
      };
      const mensaje = data.choices?.[0]?.message;
      if (!mensaje) {
        throw new OpenRouterError('OpenRouter no devolvió ningún choice.');
      }

      return { content: mensaje.content ?? null, tool_calls: mensaje.tool_calls };
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OpenRouterError(`OpenRouter no respondió en ${TIMEOUT_MS}ms.`);
      }
      this.logger.error('Fallo llamando a OpenRouter', error as Error);
      throw new OpenRouterError(`No se pudo llamar a OpenRouter: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
