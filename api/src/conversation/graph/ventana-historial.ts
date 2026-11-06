/**
 * Qué parte del historial de un chat ve el modelo. El checkpointer guarda el
 * hilo entero (y la tabla `Message` también): nada de esto borra, sólo decide
 * qué se le manda al modelo en cada mensaje. Lo usan los dos grafos.
 *
 * Tres razones para recortar:
 * - una ventana de tiempo (HISTORIAL_IA_VENTANA): lo que el cliente dijo hace
 *   semanas no tiene por qué seguir pesando en la charla de hoy;
 * - un hilo que quedó cortado a mitad de una vuelta (un AIMessage con tool
 *   calls sin su ToolMessage) hace que el proveedor rechace el pedido entero,
 *   y sin esto ese chat quedaba roto para siempre (Sentry TRATO-API-3).
 * - un tope de tokens de entrada por llamada (MAX_TOKENS_ENTRADA), que
 *   aplica el nodo de conversación con `ajustarAlPresupuesto`.
 *
 * Todo puro, sin base ni red.
 */
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
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

/**
 * Tope de tokens de entrada por llamada al modelo de conversación: system
 * prompt, herramientas e historial juntos. El de salida es MAX_TOKENS_SALIDA
 * (llm.provider.ts). Una ventana de tiempo sola no alcanza: un chat muy activo
 * o un audio largo transcripto pueden llenarla dentro de las mismas 24 h.
 */
export const MAX_TOKENS_ENTRADA = 40_000;

/**
 * Caracteres por token de la estimación. No hay tokenizer del modelo acá; el
 * español ronda 4 caracteres por token y 3,5 deja margen para el formato de los
 * mensajes y las tool calls: mejor recortar un poco de más que pasarse.
 */
const CARACTERES_POR_TOKEN = 3.5;

/** Lo que se agrega al final de un mensaje que hubo que acortar. */
export const MARCA_RECORTE = ' […]';

export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN);
}

function textoDe(mensaje: BaseMessage): string {
  const contenido = typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
  const llamadas = mensaje.getType() === 'ai' ? ((mensaje as AIMessage).tool_calls ?? []) : [];
  return llamadas.length > 0 ? contenido + JSON.stringify(llamadas) : contenido;
}

/** Lo que pesan las herramientas en el pedido: nombre, descripción y schema JSON. */
export function textoDeHerramientas(
  herramientas: ReadonlyArray<{ name: string; description: string; schema: z.ZodType }>,
): string {
  return herramientas
    .map((herramienta) => {
      let schema = '';
      try {
        schema = JSON.stringify(z.toJSONSchema(herramienta.schema));
      } catch {
        // Un schema que no se puede convertir no frena la vuelta: se cuenta sin él.
      }
      return `${herramienta.name}${herramienta.description}${schema}`;
    })
    .join('');
}

export type EntradaAjustada = {
  /** Lo que se le manda al modelo después del system prompt. */
  mensajes: BaseMessage[];
  /** Tokens estimados del pedido entero (fijo + mensajes). */
  tokens: number;
  /** Mensajes de vueltas anteriores que quedaron afuera. */
  descartados: number;
  /** Si hubo que acortar el texto de un mensaje del cliente de la vuelta en curso. */
  acortado: boolean;
  /** Si igual quedó por encima del tope (el system prompt solo ya lo pasa). */
  excedido: boolean;
};

/**
 * Deja el pedido dentro de `presupuesto` tokens. `fijo` es lo que no se
 * recorta (system prompt y herramientas). Primero saca vueltas viejas
 * enteras, cortando siempre en un mensaje del cliente para no separar una tool
 * call de su resultado; la vuelta en curso (desde el último mensaje del
 * cliente) queda siempre. Si eso no alcanza, acorta el mensaje del cliente más
 * largo de la vuelta en curso (un audio transcripto, en la práctica). No muta
 * los mensajes del estado.
 */
export function ajustarAlPresupuesto(
  fijo: string,
  mensajes: BaseMessage[],
  presupuesto: number = MAX_TOKENS_ENTRADA,
): EntradaAjustada {
  const tokensFijos = estimarTokens(fijo);
  const pesos = mensajes.map((mensaje) => estimarTokens(textoDe(mensaje)));
  let total = tokensFijos + pesos.reduce((suma, peso) => suma + peso, 0);

  const inicioVueltaActual = Math.max(
    mensajes.findLastIndex((mensaje) => mensaje.getType() === 'human'),
    0,
  );
  let desde = 0;
  while (total > presupuesto && desde < inicioVueltaActual) {
    // El próximo mensaje del cliente después de `desde`: ahí empieza la vuelta siguiente.
    let hasta = desde + 1;
    while (hasta < inicioVueltaActual && mensajes[hasta]!.getType() !== 'human') hasta++;
    for (let i = desde; i < hasta; i++) total -= pesos[i]!;
    desde = hasta;
  }

  const resultado = mensajes.slice(desde);
  let acortado = false;
  if (total > presupuesto) {
    // El mensaje del cliente más largo de la vuelta en curso, si su contenido es texto.
    let mayor = -1;
    for (let i = inicioVueltaActual - desde; i < resultado.length; i++) {
      const mensaje = resultado[i]!;
      if (mensaje.getType() !== 'human' || typeof mensaje.content !== 'string') continue;
      if (mayor === -1 || pesos[i + desde]! > pesos[mayor + desde]!) mayor = i;
    }
    if (mayor !== -1) {
      const original = resultado[mayor]!;
      const peso = pesos[mayor + desde]!;
      const disponible = Math.max(presupuesto - (total - peso) - estimarTokens(MARCA_RECORTE), 0);
      const caracteres = Math.floor(disponible * CARACTERES_POR_TOKEN);
      let corte = (original.content as string).slice(0, caracteres);
      // No dejar medio emoji (un par sustituto UTF-16 partido).
      if (/[\uD800-\uDBFF]$/.test(corte)) corte = corte.slice(0, -1);
      const texto = corte + MARCA_RECORTE;
      resultado[mayor] = new HumanMessage({ content: texto, id: original.id, response_metadata: original.response_metadata });
      total = total - peso + estimarTokens(texto);
      acortado = true;
    }
  }

  return { mensajes: resultado, tokens: total, descartados: desde, acortado, excedido: total > presupuesto };
}
