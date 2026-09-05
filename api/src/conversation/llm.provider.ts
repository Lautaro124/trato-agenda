/**
 * El modelo del runtime conversacional, apuntado al endpoint OpenAI-compatible
 * de OpenRouter. El proyecto sigue sin atarse a un proveedor: se cambia con
 * OPENROUTER_MODEL. `OpenRouterClient` (el fetch pelado) sigue siendo el camino
 * del meta-agente y del resumen de cliente.
 */
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export const LLM_CONVERSACION = 'LLM_CONVERSACION';

const BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 20_000;

export const llmProvider = {
  provide: LLM_CONVERSACION,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new ChatOpenAI({
      model: config.get('OPENROUTER_MODEL', { infer: true }),
      apiKey: config.get('OPENROUTER_API_KEY', { infer: true }) || 'sin-configurar',
      timeout: TIMEOUT_MS,
      maxRetries: 1,
      configuration: {
        baseURL: BASE_URL,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato Agenda',
        },
      },
    }),
};
