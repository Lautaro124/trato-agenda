/**
 * Qué parte del historial de un chat ve el modelo. El checkpointer guarda el
 * hilo entero (y la tabla `Message` también): nada de esto borra, sólo decide
 * qué se le manda al modelo en cada mensaje. Lo usan los dos grafos.
 *
 * Dos razones para recortar:
 * - una ventana de tiempo (HISTORIAL_IA_VENTANA): lo que el cliente dijo hace
 *   semanas no tiene por qué seguir pesando en la charla de hoy;
 * - un hilo que quedó cortado a mitad de una vuelta (un AIMessage con tool
 *   calls sin su ToolMessage) hace que el proveedor rechace el pedido entero,
 *   y sin esto ese chat quedaba roto para siempre (Sentry TRATO-API-3).
 *
 * Todo puro, sin base ni red.
 */
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { HISTORIAL_IA_VENTANA_POR_DEFECTO, parsearDuracion } from '../../config/env.js';

/** La ventana cuando no se configura (la misma que toma validateEnv). */
export const VENTANA_POR_DEFECTO_MS = parsearDuracion(HISTORIAL_IA_VENTANA_POR_DEFECTO) as number;

/** Dónde se guarda, en cada mensaje del cliente, cuándo llegó. No viaja al proveedor. */
const CLAVE_RECIBIDO = 'recibidoEn';

/** Cuándo llegó un mensaje del cliente, o null si es de antes de que existiera la marca. */
export function recibidoEn(mensaje: BaseMessage): Date | null {
  const valor = (mensaje.response_metadata as Record<string, unknown> | undefined)?.[CLAVE_RECIBIDO];
  if (typeof valor !== 'string') return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** El mismo mensaje del cliente con la hora en que llegó. Conserva el id: el reducer lo reemplaza en su lugar. */
export function conMarcaDeLlegada(mensaje: BaseMessage, cuando: Date): HumanMessage {
  return new HumanMessage({
    content: mensaje.content,
    id: mensaje.id,
    response_metadata: { ...mensaje.response_metadata, [CLAVE_RECIBIDO]: cuando.toISOString() },
  });
}

/**
 * Índice del primer mensaje que ve el modelo: el primer mensaje del cliente
 * que llegó dentro de la ventana. Se corta siempre en un mensaje del cliente,
 * que es donde empieza una vuelta, así que nunca separa una tool call de su
 * resultado. Los mensajes sin marca (los de antes de que existiera) cuentan
 * como viejos. El último mensaje —el que acaba de llegar— queda siempre
 * adentro.
 */
export function inicioVisible(messages: BaseMessage[], ahora: Date, ventanaMs: number): number {
  const ultimo = Math.max(messages.length - 1, 0);
  const desde = ahora.getTime() - ventanaMs;
  const indice = messages.findIndex((mensaje) => {
    if (mensaje.getType() !== 'human') return false;
    const fecha = recibidoEn(mensaje);
    return fecha !== null && fecha.getTime() >= desde;
  });
  return indice === -1 ? ultimo : Math.min(indice, ultimo);
}

/**
 * Descarta los pares tool_call/resultado que quedaron cortados: un assistant
 * con tool_calls sin su ToolMessage (o al revés) hace que la API del modelo
 * rechace el pedido entero.
 */
export function sinParesCortados(mensajes: BaseMessage[]): BaseMessage[] {
  const respondidos = new Set(
    mensajes.filter((mensaje) => mensaje.getType() === 'tool').map((mensaje) => (mensaje as ToolMessage).tool_call_id),
  );
  const pedidos = new Set(
    mensajes
      .filter((mensaje) => mensaje.getType() === 'ai')
      .flatMap((mensaje) => ((mensaje as AIMessage).tool_calls ?? []).map((call) => call.id ?? '')),
  );

  return mensajes.filter((mensaje) => {
    if (mensaje.getType() === 'tool') {
      return pedidos.has((mensaje as ToolMessage).tool_call_id);
    }
    const llamadas = mensaje.getType() === 'ai' ? ((mensaje as AIMessage).tool_calls ?? []) : [];
    return llamadas.every((call) => respondidos.has(call.id ?? ''));
  });
}

/** Lo que ve el modelo: desde `inicio` y sin pares cortados. */
export function mensajesVisibles(messages: BaseMessage[], inicio: number): BaseMessage[] {
  return sinParesCortados(messages.slice(inicio));
}

export type HistorialDelTurno = {
  /** El mensaje que acaba de llegar, ya con su hora, si hubo que marcarlo (va de vuelta al estado). */
  marcado: HumanMessage | null;
  /** Primer índice de `messages` que ve el modelo en esta vuelta. */
  inicio: number;
  /** Lo que ve el modelo al arrancar la vuelta. */
  visibles: BaseMessage[];
  /**
   * Si quedó historial fuera de la ventana. Entonces `Conversation.resumen`
   * tampoco va al modelo: puede hablar de esa charla vieja, y no se sabe de
   * cuándo es.
   */
  hayHistorialOculto: boolean;
};

/**
 * Lo que hace cada `cargar_contexto` con el historial al empezar una vuelta:
 * marca la hora del mensaje que acaba de llegar (si no la trae, como cuando
 * entra por el banco de pruebas o por un test) y calcula desde dónde lo ve el
 * modelo.
 */
export function prepararHistorial(messages: BaseMessage[], ahora: Date, ventanaMs: number): HistorialDelTurno {
  const ultimo = messages.at(-1);
  const marcado = ultimo && ultimo.getType() === 'human' && !recibidoEn(ultimo) ? conMarcaDeLlegada(ultimo, ahora) : null;
  const conMarca = marcado ? [...messages.slice(0, -1), marcado] : messages;
  const inicio = inicioVisible(conMarca, ahora, ventanaMs);
  return {
    marcado,
    inicio,
    visibles: mensajesVisibles(conMarca, inicio),
    hayHistorialOculto: inicio > 0,
  };
}
