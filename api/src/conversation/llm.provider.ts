/**
 * El modelo del runtime conversacional, apuntado al endpoint OpenAI-compatible
 * de OpenRouter. El proyecto sigue sin atarse a un proveedor: se cambia con
 * OPENROUTER_MODEL. `OpenRouterClient` (el fetch pelado) sigue siendo el camino
 * del meta-agente y del resumen de cliente.
 */
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { POLITICA_DE_PROVEEDOR } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';

export const LLM_CONVERSACION = 'LLM_CONVERSACION';

/**
 * Con reasoning activo la primera respuesta tarda más: con 20s el cliente se
 * comía la disculpa genérica en mensajes largos.
 */
const TIMEOUT_MS = 40_000;

/**
 * `reasoning` es el parámetro unificado de OpenRouter. `effort: 'low'` es el
 * equilibrio que buscamos: alcanza para desambiguar cómo escribe la gente por
 * WhatsApp ("el jueves a la tardecita", "mejor movelo una hora") sin agregar la
 * latencia de un modelo pensando de más. `exclude: true` deja el bloque de
 * pensamiento fuera de la respuesta: se paga igual, pero no ensucia el `content`
 * que se manda por WhatsApp ni el checkpoint de la conversación.
 */
const RAZONAMIENTO = { effort: 'low', exclude: true } as const;

export const llmProvider = {
  provide: LLM_CONVERSACION,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new ChatOpenAI({
      model: config.get('OPENROUTER_MODEL', { infer: true }),
      apiKey: config.get('OPENROUTER_API_KEY', { infer: true }) || 'sin-configurar',
      timeout: TIMEOUT_MS,
      maxRetries: 1,
      // `provider` es la misma política de no-entrenamiento / ZDR que usa el
      // meta-agente: viaja en cada request, no sólo en la política de privacidad.
      modelKwargs: { reasoning: RAZONAMIENTO, provider: POLITICA_DE_PROVEEDOR },
      configuration: {
        // Configurable para que los E2E hablen con un OpenRouter falso y determinista.
        baseURL: config.get('OPENROUTER_BASE_URL', { infer: true }),
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato Agenda',
        },
      },
    }),
};
