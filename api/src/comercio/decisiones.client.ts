import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POLITICA_DE_PROVEEDOR, resumenDeError } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';
import { MAX_OPCIONES_DECISION, ordenarPorProbabilidad } from './sugerencias.rules.js';

/**
 * Corto a propósito: Jev contesta en milisegundos, y mientras tanto el cliente
 * espera la respuesta del asistente. Si tarda, se usa el orden determinista.
 */
const TIMEOUT_MS = 5_000;

/** Id de la pregunta: hay una sola por pedido. */
const PREGUNTA = 'interes';

/** Se lanza cuando OpenRouter no está configurado o la llamada falla. */
export class DecisionesError extends Error {}

export type PedidoDeEleccion = {
  /** Lo que escribió el cliente (estadoParaDecidir). */
  estado: string;
  /** Qué tiene que decidir Jev, en inglés: es su idioma de entrenamiento. */
  instrucciones: string;
  /** id → descripción de cada opción. Los ids son internos (c0, p3…), no textos del dueño. */
  opciones: Record<string, string>;
  /** Qué significa "ninguna" (la API exige esa opción). */
  ninguna: string;
};

type RespuestaDecisiones = {
  answers?: Record<string, { choice?: unknown; probabilities?: Record<string, unknown> }>;
};

/**
 * Wrapper delgado sobre la Decisions API de OpenRouter, que es la única forma
 * de hablar con Jev (`typesafe/jev-1.13`): no es un modelo de chat, recibe un
 * `state` y preguntas tipadas y devuelve probabilidades por opción, sin texto.
 * Misma forma que EmbeddingsClient: `fetch` directo, sin SDK.
 *
 * Lleva `POLITICA_DE_PROVEEDOR` como el resto: el `state` es lo que escribió
 * el cliente por WhatsApp. Jev tiene endpoint ZDR en OpenRouter.
 */
@Injectable()
export class DecisionesClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** false sin OPENROUTER_API_KEY: las sugerencias salen en el orden determinista. */
  get configurado(): boolean {
    return Boolean(this.config.get('OPENROUTER_API_KEY', { infer: true }));
  }

  /**
   * Los ids de `opciones` de la que más a la que menos le puede interesar al
   * cliente según Jev, sin la opción "ninguna". Una sola pregunta `choice`:
   * se ordena por `probabilities`, no sólo por la ganadora.
   */
  async ordenar(pedido: PedidoDeEleccion): Promise<string[]> {
    const ids = Object.keys(pedido.opciones);
    if (ids.length === 0) return [];
    if (ids.length > MAX_OPCIONES_DECISION) {
      throw new DecisionesError(`Jev admite hasta ${MAX_OPCIONES_DECISION} opciones por pregunta.`);
    }
    if (ids.includes('none')) throw new DecisionesError('"none" es una opción reservada.');
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) {
      throw new DecisionesError('OPENROUTER_API_KEY no está configurada. Definila en api/.env (ver README).');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.config.get('OPENROUTER_DECISIONS_URL', { infer: true }), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/trato-agenda',
          'X-Title': 'Trato',
        },
        body: JSON.stringify({
          model: this.config.get('OPENROUTER_DECISIONS_MODEL', { infer: true }),
          state: pedido.estado,
          questions: {
            [PREGUNTA]: {
              type: 'choice',
              instructions: pedido.instrucciones,
              criteria: { ...pedido.opciones, none: pedido.ninguna },
            },
          },
          provider: POLITICA_DE_PROVEEDOR,
        }),
      });

      if (!res.ok) {
        // Sin el cuerpo: puede repetir lo que escribió el cliente.
        throw new DecisionesError(`OpenRouter respondió ${res.status} al pedir una decisión.`);
      }
      return ordenDeLaRespuesta((await res.json()) as RespuestaDecisiones, ids);
    } catch (error) {
      if (error instanceof DecisionesError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DecisionesError(`OpenRouter no devolvió la decisión en ${TIMEOUT_MS}ms.`);
      }
      throw new DecisionesError(`No se pudo pedir la decisión: ${resumenDeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Las opciones ordenadas por probabilidad. Si la respuesta trae sólo la
 * ganadora, esa va primero y el resto queda como estaba; si no trae nada
 * reconocible, es un error (mejor el orden determinista que uno inventado).
 */
export function ordenDeLaRespuesta(respuesta: RespuestaDecisiones, ids: string[]): string[] {
  const respuestaPregunta = respuesta.answers?.[PREGUNTA];
  const crudas = respuestaPregunta?.probabilities;
  const probabilidades: Record<string, number> = {};
  if (crudas && typeof crudas === 'object') {
    for (const id of ids) {
      const valor = crudas[id];
      if (typeof valor === 'number' && Number.isFinite(valor)) probabilidades[id] = valor;
    }
  }
  const elegida = respuestaPregunta?.choice;
  if (Object.keys(probabilidades).length === 0) {
    if (typeof elegida === 'string' && ids.includes(elegida)) probabilidades[elegida] = 1;
    else if (elegida !== 'none') throw new DecisionesError('La respuesta de Jev no trae probabilidades.');
  }
  return ordenarPorProbabilidad(ids, probabilidades);
}
