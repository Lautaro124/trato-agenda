/**
 * El ritmo de una persona que contesta WhatsApp, como funciones puras: cuánto
 * esperar a que el cliente termine de escribir, cuánto tarda en "tipear" cada
 * mensaje y cómo se parte una respuesta en varios mensajes. Contestar en el
 * mismo segundo, sin "escribiendo…" y en un solo bloque es lo que más delata
 * a un bot, aunque el texto suene natural.
 */

/** Silencio que se espera después del último mensaje del cliente antes de contestar: la gente escribe en ráfagas. */
export const ESPERA_RAFAGA_MS = 3_500;
/** Tope de espera desde el primer mensaje de la ráfaga, para que alguien que escribe sin parar igual tenga respuesta. */
export const MAXIMO_RAFAGA_MS = 12_000;
/** WhatsApp borra el "escribiendo…" a los ~10 s si no se renueva. */
export const RENOVAR_ESCRIBIENDO_MS = 8_000;

/** Velocidad de tipeo simulada: unos 30 caracteres por segundo, rápida pero creíble en un celular. */
const MS_POR_CARACTER = 33;
const DEMORA_MINIMA_MS = 1_000;
const DEMORA_MAXIMA_MS = 7_000;

/** Como mucho tantos mensajes por respuesta: más que eso ya parece un spam de burbujas. */
export const MAX_PARTES = 3;

/**
 * Cuánto "tarda en escribir" un mensaje. `azar` (0..1) le suma hasta un 20 %
 * para que dos respuestas del mismo largo no tarden exactamente lo mismo.
 */
export function demoraDeEscritura(texto: string, azar = 0.5): number {
  const base = Math.min(DEMORA_MAXIMA_MS, Math.max(DEMORA_MINIMA_MS, texto.length * MS_POR_CARACTER));
  return Math.round(base * (1 + 0.2 * azar));
}

/**
 * Lo que falta esperar antes de mandar, descontando lo que ya pasó (el modelo
 * pensando cuenta como tiempo de tipeo: el cliente ya vio "escribiendo…").
 */
export function demoraRestante(demora: number, transcurrido: number): number {
  return Math.max(0, demora - transcurrido);
}

/**
 * Parte una respuesta en los mensajes que manda una persona: un bloque por
 * cada línea en blanco. Las reglas de estilo le piden al modelo separar así
 * sólo cuando son ideas distintas; una lista (renglones seguidos con "* ")
 * queda entera porque no tiene líneas en blanco adentro. Lo que pase de
 * MAX_PARTES se junta en el último mensaje.
 */
export function partirEnMensajes(texto: string, maximo = MAX_PARTES): string[] {
  const partes = texto
    .split(/\n[ \t]*\n/)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
  if (partes.length === 0) return texto.trim() ? [texto.trim()] : [];
  if (partes.length <= maximo) return partes;
  return [...partes.slice(0, maximo - 1), partes.slice(maximo - 1).join('\n\n')];
}

/** Cuánto esperar antes de vaciar una ráfaga: el silencio pedido, sin pasarse del tope desde el primer mensaje. */
export function esperaDeRafaga(desde: number, ahora: number): number {
  return Math.max(0, Math.min(ESPERA_RAFAGA_MS, desde + MAXIMO_RAFAGA_MS - ahora));
}
