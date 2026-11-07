import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POLITICA_DE_PROVEEDOR, resumenDeError } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';

/** Modelo de voz a texto de los audios de WhatsApp. */
export const MODELO_TRANSCRIPCION = 'openai/whisper-large-v3-turbo';

/** Audios de más de 1 h 30 min no se descargan ni se transcriben. */
export const MAX_SEGUNDOS_AUDIO = 90 * 60;

/**
 * Tope de bytes por si WhatsApp no informa la duración o miente, y el límite
 * de archivo que documentan OpenRouter (25 MB por archivo) y Groq (25 MB en el
 * plan gratuito). Una nota de voz opus de WhatsApp (16-32 kbps) de 1 h 30 min
 * entra; un mp3 adjunto de buena calidad de esa duración no, y se contesta como
 * audio largo.
 */
export const MAX_BYTES_AUDIO = 25 * 1024 * 1024;

/** Plazo mínimo de una transcripción: el de un audio corto. */
const TIMEOUT_BASE_MS = 30_000;
/** Lo que se suma por cada segundo de audio: Whisper turbo va muy por encima del tiempo real. */
const TIMEOUT_POR_SEGUNDO_MS = 50;

/**
 * Cuánto se espera a OpenRouter para un audio de `segundos`: 30 s para uno
 * corto y unos 5 min para uno de 1 h 30 min. `segundos` lo declara el que
 * manda, por eso queda acotado a MAX_SEGUNDOS_AUDIO.
 */
export function plazoDeTranscripcion(segundos: number): number {
  const acotado = Number.isFinite(segundos) ? Math.min(Math.max(segundos, 0), MAX_SEGUNDOS_AUDIO) : 0;
  return TIMEOUT_BASE_MS + Math.round(acotado * TIMEOUT_POR_SEGUNDO_MS);
}

/** Se lanza cuando OpenRouter no está configurado o la transcripción falla. */
export class TranscripcionError extends Error {}

/**
 * Wrapper delgado sobre `POST /audio/transcriptions` de OpenRouter, con la
 * misma forma que EmbeddingsClient: `fetch` directo, sin SDK.
 *
 * Lleva `POLITICA_DE_PROVEEDOR`: el audio es conversación del cliente y no
 * puede ir a un proveedor que lo retenga o entrene con él. Ni el audio ni la
 * transcripción se guardan en disco ni van a los logs.
 */
@Injectable()
export class TranscripcionClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * `formato` es la extensión que entiende OpenRouter (`ogg`, `mp3`, `m4a`…).
   * `segundos` (la duración que informa WhatsApp) sólo alarga el plazo.
   */
  async transcribir(audio: Buffer, formato: string, segundos = 0): Promise<string> {
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) throw new TranscripcionError('OPENROUTER_API_KEY no está configurada.');

    const plazoMs = plazoDeTranscripcion(segundos);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), plazoMs);
    const baseUrl = this.config.get('OPENROUTER_BASE_URL', { infer: true });

    try {
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato',
        },
        body: JSON.stringify({
          model: MODELO_TRANSCRIPCION,
          input_audio: { data: audio.toString('base64'), format: formato },
          // Los clientes escriben en español; fijarlo evita que un audio corto o con ruido se detecte en otro idioma.
          language: 'es',
          provider: POLITICA_DE_PROVEEDOR,
        }),
      });

      if (!res.ok) {
        // Sin el cuerpo: puede repetir lo que dijo el cliente.
        throw new TranscripcionError(`OpenRouter respondió ${res.status} al transcribir un audio.`);
      }

      const data = (await res.json()) as { text?: unknown };
      if (typeof data.text !== 'string') throw new TranscripcionError('OpenRouter devolvió una transcripción sin texto.');
      return data.text.trim();
    } catch (error) {
      if (error instanceof TranscripcionError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TranscripcionError(`OpenRouter no transcribió el audio en ${plazoMs}ms.`);
      }
      throw new TranscripcionError(`No se pudo transcribir el audio: ${resumenDeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Formato para OpenRouter a partir del mimetype de WhatsApp. Las notas de voz
 * llegan como `audio/ogg; codecs=opus`; los audios adjuntos pueden ser mp3, m4a, etc.
 * undefined si no es un formato que OpenRouter acepte.
 */
export function formatoDeAudio(mimetype: string | null | undefined): string | undefined {
  const tipo = (mimetype ?? 'audio/ogg').split(';')[0]!.trim().toLowerCase();
  return Object.hasOwn(FORMATOS, tipo) ? FORMATOS[tipo] : undefined;
}

const FORMATOS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};
