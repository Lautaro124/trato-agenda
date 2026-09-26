import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POLITICA_DE_PROVEEDOR, resumenDeError } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';

/**
 * Dimensiones de `openai/text-embedding-3-small`. Tiene que coincidir con la
 * columna `Producto.embedding vector(1536)`: cambiar de modelo a uno con otra
 * dimensión es una migración, no una variable de entorno.
 */
export const DIMENSIONES_EMBEDDING = 1536;

/** Tope de textos por pedido: el indexador manda lotes de este tamaño. */
export const MAX_TEXTOS_POR_PEDIDO = 100;

const TIMEOUT_MS = 20_000;

/** Se lanza cuando OpenRouter no está configurado o la llamada falla. */
export class EmbeddingsError extends Error {}

/**
 * Wrapper delgado sobre `POST /embeddings` de OpenRouter, con la misma forma
 * que OpenRouterClient: `fetch` directo, sin SDK.
 *
 * Lleva `POLITICA_DE_PROVEEDOR` igual que el chat: lo que se embebe en cada
 * búsqueda es lo que escribió el cliente por WhatsApp, así que es
 * conversación y no puede ir a un proveedor que la retenga o entrene con ella.
 * `openai/text-embedding-3-small` tiene endpoint ZDR (Azure).
 */
@Injectable()
export class EmbeddingsClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** false sin OPENROUTER_API_KEY: el catálogo funciona igual, sólo con búsqueda por texto. */
  get configurado(): boolean {
    return Boolean(this.config.get('OPENROUTER_API_KEY', { infer: true }));
  }

  async embeber(textos: string[]): Promise<number[][]> {
    if (textos.length === 0) return [];
    if (textos.length > MAX_TEXTOS_POR_PEDIDO) {
      throw new EmbeddingsError(`Se pueden embeber hasta ${MAX_TEXTOS_POR_PEDIDO} textos por pedido.`);
    }
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) {
      throw new EmbeddingsError('OPENROUTER_API_KEY no está configurada. Definila en api/.env (ver README).');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const baseUrl = this.config.get('OPENROUTER_BASE_URL', { infer: true });

    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato Agenda',
        },
        body: JSON.stringify({
          model: this.config.get('OPENROUTER_EMBEDDINGS_MODEL', { infer: true }),
          input: textos,
          encoding_format: 'float',
          provider: POLITICA_DE_PROVEEDOR,
        }),
      });

      if (!res.ok) {
        // Sin el cuerpo: puede repetir el texto del cliente.
        throw new EmbeddingsError(`OpenRouter respondió ${res.status} al pedir embeddings.`);
      }

      const data = (await res.json()) as { data?: Array<{ embedding?: unknown; index?: number }> };
      return ordenarYValidar(data.data, textos.length);
    } catch (error) {
      if (error instanceof EmbeddingsError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmbeddingsError(`OpenRouter no devolvió los embeddings en ${TIMEOUT_MS}ms.`);
      }
      throw new EmbeddingsError(`No se pudieron pedir los embeddings: ${resumenDeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Ordena por `index` (la API no promete el orden) y valida cantidad y dimensión. */
export function ordenarYValidar(
  datos: Array<{ embedding?: unknown; index?: number }> | undefined,
  esperados: number,
): number[][] {
  if (!Array.isArray(datos) || datos.length !== esperados) {
    throw new EmbeddingsError(`OpenRouter devolvió ${datos?.length ?? 0} embeddings y se esperaban ${esperados}.`);
  }
  const ordenados = [...datos].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordenados.map((dato) => {
    const vector = dato.embedding;
    if (
      !Array.isArray(vector) ||
      vector.length !== DIMENSIONES_EMBEDDING ||
      !vector.every((valor) => typeof valor === 'number' && Number.isFinite(valor))
    ) {
      throw new EmbeddingsError(`OpenRouter devolvió un embedding que no es de ${DIMENSIONES_EMBEDDING} números.`);
    }
    return vector as number[];
  });
}

/** Literal de pgvector ("[0.1,0.2,...]") para pasar como parámetro con `::vector`. */
export function literalVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
