import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const TIMEOUT_MS = 20_000;

/**
 * Política de datos que viaja en **todas** las llamadas, del meta-agente y del
 * runtime conversacional (`llm.provider.ts` importa esta misma constante para
 * que no puedan divergir).
 *
 * - `data_collection: 'deny'` rutea sólo a proveedores que no guardan los
 *   datos de forma no transitoria ni entrenan con ellos.
 * - `zdr: true` restringe el ruteo a endpoints con política de Zero Data
 *   Retention, así el prompt no queda persistido del otro lado.
 *
 * Es el requisito de Limited Use de Google en código y no sólo en la política
 * de privacidad. En la cuenta de OpenRouter está activado lo mismo: el flag por
 * request opera como OR con la configuración de cuenta. Cambiarlo o sacarlo
 * contradice lo que la app declara públicamente en /privacidad.
 *
 * Contra a tener presente: restringe el conjunto de proveedores elegibles, así
 * que un modelo sin endpoint ZDR deja de estar disponible. Correr `npm run eval`
 * antes de cambiar de modelo.
 */
export const POLITICA_DE_PROVEEDOR = {
  data_collection: 'deny',
  zdr: true,
} as const;

/**
 * Mensaje corto y acotado para loguear un error de LLM. El cuerpo de error de
 * un proveedor puede repetir el prompt, y el prompt lleva la conversación del
 * cliente: no queremos eso en los logs.
 */
export function resumenDeError(error: unknown): string {
  if (!(error instanceof Error)) return 'error desconocido';
  return `${error.name}: ${error.message.slice(0, 200)}`;
}

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

/** Consumo que informa OpenRouter. Sólo lo mira el eval de modelos. */
export type UsoTokens = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export type ChatCompletionMessage = {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: UsoTokens;
};

/**
 * Control de razonamiento de OpenRouter (parámetro unificado, funciona con
 * cualquier modelo que lo soporte). El runtime conversacional lo quiere
 * prendido; el meta-agente y el resumen de cliente lo apagan a propósito.
 */
export type Razonamiento = {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
  exclude?: boolean;
};

/** Schema JSON para structured outputs (`response_format: json_schema`). */
export type EsquemaJson = {
  name: string;
  schema: Record<string, unknown>;
};

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Pide JSON estructurado. Sin tools, típicamente usado por el meta-agente. */
  jsonMode?: boolean;
  /**
   * Structured outputs estricto: el proveedor tiene que respetar el schema.
   * Tiene prioridad sobre `jsonMode` y fuerza `require_parameters`, así
   * OpenRouter no enruta a un proveedor que lo ignore en silencio.
   */
  jsonSchema?: EsquemaJson;
  /** Override puntual del modelo; por defecto usa OPENROUTER_MODEL. */
  model?: string;
  /** Sin esto se usa el default del modelo (que en Gemma 4 es pensar). */
  reasoning?: Razonamiento;
  /** Override del timeout: escribir un system prompt entero tarda más que una respuesta corta. */
  timeoutMs?: number;
  /** Tope de tokens de salida, para que una respuesta desbocada no se coma el timeout. */
  maxTokens?: number;
};

/** Se lanza cuando OpenRouter no está configurado o la llamada falla. */
export class OpenRouterError extends Error {}

/**
 * La llamada no volvió a tiempo. Separada del resto porque reintentarla
 * duplica la espera sin arreglar nada (así fallaba la generación en prod).
 */
export class OpenRouterTimeoutError extends OpenRouterError {}

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

    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const baseUrl = this.config.get('OPENROUTER_BASE_URL', { infer: true });

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
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
          ...formatoDeRespuesta(options),
          provider: {
            ...POLITICA_DE_PROVEEDOR,
            // Structured outputs estricto: sin esto OpenRouter puede enrutar a
            // un proveedor que ignore el schema en silencio.
            ...(options.jsonSchema ? { require_parameters: true } : {}),
          },
          ...(options.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
      });

      if (!res.ok) {
        // Sin el cuerpo: puede venir con el prompt entero adentro y este
        // error termina en `logger.error`.
        throw new OpenRouterError(`OpenRouter respondió ${res.status}.`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: ChatCompletionMessage }>;
        usage?: UsoTokens;
      };
      const mensaje = data.choices?.[0]?.message;
      if (!mensaje) {
        throw new OpenRouterError('OpenRouter no devolvió ningún choice.');
      }

      return {
        content: mensaje.content ?? null,
        tool_calls: mensaje.tool_calls,
        ...(data.usage ? { usage: data.usage } : {}),
      };
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OpenRouterTimeoutError(`OpenRouter no respondió en ${timeoutMs}ms.`);
      }
      this.logger.error(`Fallo llamando a OpenRouter: ${resumenDeError(error)}`);
      throw new OpenRouterError(`No se pudo llamar a OpenRouter: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function formatoDeRespuesta(options: ChatOptions): Record<string, unknown> {
  if (options.jsonSchema) {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: { name: options.jsonSchema.name, strict: true, schema: options.jsonSchema.schema },
      },
    };
  }
  return options.jsonMode ? { response_format: { type: 'json_object' } } : {};
}
