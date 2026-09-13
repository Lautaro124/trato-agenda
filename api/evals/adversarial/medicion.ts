/**
 * Instrumentación de medición por capas para los evals y la matriz de
 * cobertura adversarial. Nada de acá se usa en producción — vive fuera de
 * `src/` a propósito, igual que `api/evals/`.
 *
 * La spec de evaluación integral pide separar: cola, intento HTTP/LLM, llamada
 * lógica (con reintentos), tool call, mensaje y conversación completa; nunca
 * deducir un timeout de la duración total de un `grafo.invoke` (que puede
 * recorrer conversacion→validacion→calendar→conversacion varias veces); y
 * nunca contar dos veces la misma tool call cuando el checkpointer acumula
 * mensajes de vueltas anteriores en el mismo thread.
 */
import type { AIMessage, BaseMessage } from '@langchain/core/messages';

export type CapaMedicion = 'cola' | 'intento_http' | 'llamada_logica' | 'tool' | 'mensaje' | 'conversacion';

export type RegistroMedicion = {
  capa: CapaMedicion;
  id: string;
  /** Para agrupar: ids de los intentos de una llamada_logica, o de las llamadas_logica de un mensaje. */
  idPadre?: string;
  inicioMs: number;
  finMs: number;
  ok: boolean;
  statusHttp?: number;
  errorNombre?: string;
  reintentoNum?: number;
  finishReason?: string;
  modeloSolicitado?: string;
  modeloEfectivo?: string;
  proveedorEfectivo?: string;
  tokens?: { prompt?: number; completion?: number; reasoning?: number; cached?: number };
  /** `null` = costo desconocido (el proveedor no lo informó). Nunca 0 por defecto. */
  costoUsd?: number | null;
};

/**
 * Instrumenta `globalThis.fetch` sólo durante la corrida del eval (no toca
 * `src/`): registra cada intento HTTP y, cuando puede, lee el body de la
 * respuesta para detectar un fallback silencioso de modelo/proveedor (lo que
 * OpenRouter dice haber usado puede no ser lo que se pidió). Devuelve una
 * función para restaurar el `fetch` original.
 */
export function instrumentarFetch(sink: (registro: RegistroMedicion) => void): () => void {
  const original = globalThis.fetch;
  let numeroDeIntento = 0;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const inicioMs = performance.now();
    numeroDeIntento += 1;
    const idIntento = crypto.randomUUID();
    try {
      const respuesta = await original(...args);
      let modeloEfectivo: string | undefined;
      let tokens: RegistroMedicion['tokens'];
      try {
        const cuerpo = (await respuesta.clone().json()) as {
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } };
        };
        modeloEfectivo = cuerpo.model;
        if (cuerpo.usage) {
          tokens = {
            prompt: cuerpo.usage.prompt_tokens,
            completion: cuerpo.usage.completion_tokens,
            reasoning: cuerpo.usage.completion_tokens_details?.reasoning_tokens,
            cached: cuerpo.usage.prompt_tokens_details?.cached_tokens,
          };
        }
      } catch {
        // Respuesta no-JSON (ej. un 502 de un proxy): igual se registra el intento HTTP.
      }
      sink({
        capa: 'intento_http',
        id: idIntento,
        inicioMs,
        finMs: performance.now(),
        ok: respuesta.ok,
        statusHttp: respuesta.status,
        reintentoNum: numeroDeIntento,
        modeloEfectivo,
        tokens,
      });
      return respuesta;
    } catch (error) {
      sink({
        capa: 'intento_http',
        id: idIntento,
        inicioMs,
        finMs: performance.now(),
        ok: false,
        errorNombre: (error as Error).name,
        reintentoNum: numeroDeIntento,
      });
      throw error;
    }
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

export type ResultadoConteo = { herramientas: string[]; cursor: number };

/**
 * Cuenta las tool calls "nuevas" de un `grafo.invoke` sin recontar las de
 * vueltas anteriores del mismo thread. Corrige el bug real de
 * `conversacion.eval.ts`, que usaba una ventana fija (`slice(-12)`) sobre un
 * `estado.messages` que crece en cada invoke del mismo `thread_id`: con pocos
 * mensajes por caso, esa ventana podía volver a incluir `AIMessage`s (y sus
 * tool_calls) ya contados en una vuelta previa del mismo caso.
 *
 * `cursorAnterior` es la cantidad de mensajes ya contados (avanza a
 * `estado.messages.length` después de cada invoke); `vistos` es el conjunto de
 * `tool_call.id` ya sumados, como segundo blindaje independiente del cursor.
 */
export function contarToolCallsNuevas(
  mensajes: BaseMessage[],
  cursorAnterior: number,
  vistos: Set<string>,
): ResultadoConteo {
  const nuevos = mensajes.slice(cursorAnterior).filter((mensaje) => mensaje.getType() === 'ai') as AIMessage[];
  const herramientas: string[] = [];
  for (const mensaje of nuevos) {
    for (const llamada of mensaje.tool_calls ?? []) {
      if (llamada.id && vistos.has(llamada.id)) continue;
      if (llamada.id) vistos.add(llamada.id);
      herramientas.push(llamada.name);
    }
  }
  return { herramientas, cursor: mensajes.length };
}
