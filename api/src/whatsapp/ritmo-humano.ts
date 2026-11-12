/**
 * El ritmo de una persona que contesta WhatsApp, como funciones puras: cuánto
 * esperar a que el cliente termine de escribir, cuánto tarda en "tipear" cada
 * mensaje y cómo se parte una respuesta en varios mensajes. Contestar en el
 * mismo segundo, sin "escribiendo…" y en un solo bloque es lo que más delata
 * a un bot, aunque el texto suene natural.
 */

/**
 * Silencio que se espera después del último mensaje del cliente antes de
 * contestar: la gente escribe en ráfagas. Cada mensaje nuevo reinicia la
 * cuenta. Si WhatsApp avisa que está escribiendo, además se espera a que pare
 * (ESPERA_TRAS_ESCRIBIR_MS); si no avisa, queda sólo este silencio.
 */
export const ESPERA_RAFAGA_MS = 4_000;

/** Cuánto después de que llega un mensaje se lo marca como leído, aunque la respuesta tarde más. */
export const ESPERA_LEIDO_MS = 1_000;

/** Después de que el cliente deja de escribir, lo que se le da por si retoma antes de contestar. */
export const ESPERA_TRAS_ESCRIBIR_MS = 2_000;

/**
 * Por defecto, cuánto dura un "escribiendo…" del cliente sin un aviso de que
 * paró: si el aviso se pierde, el chat no queda esperando para siempre.
 * Se configura con WHATSAPP_ESCRIBIENDO_VENCE_SEGUNDOS.
 */
export const ESCRIBIENDO_VENCE_POR_DEFECTO_MS = 30_000;

/** Lo que "tarda en reaccionar" alguien después de escuchar un audio, además de su duración. */
const REACCION_AUDIO_MIN_MS = 2_000;
const REACCION_AUDIO_MAX_MS = 4_000;

/**
 * Lo más que se "escucha" un audio antes de contestar. Con audios de hasta
 * 1 h 30 min, esperar la duración entera dejaba el chat colgado: pasados los
 * 2 minutos se contesta igual (alguien que recibe un audio largo responde
 * antes de terminarlo o lo escucha acelerado).
 */
export const MAX_ESCUCHA_AUDIO_MS = 120_000;

/**
 * Cuánto retener un audio antes de sumarlo a la ráfaga, para que la respuesta
 * llegue como si alguien lo hubiera escuchado entero: su duración más 2 a 4 s
 * (`azar`, 0..1). Se descuenta ESPERA_RAFAGA_MS porque la ráfaga igual espera
 * ese silencio después: un audio de 30 s se contesta a los ~32-34 s, no a los 38.
 * La duración cuenta hasta MAX_ESCUCHA_AUDIO_MS.
 */
export function esperaDeEscucha(segundos: number, azar = 0.5): number {
  const reaccion = REACCION_AUDIO_MIN_MS + (REACCION_AUDIO_MAX_MS - REACCION_AUDIO_MIN_MS) * azar;
  const escucha = Math.min(segundos * 1000, MAX_ESCUCHA_AUDIO_MS);
  return Math.max(0, Math.round(escucha + reaccion - ESPERA_RAFAGA_MS));
}
/**
 * Tope del silencio desde el primer mensaje de la ráfaga, para que alguien que
 * manda mensajes sin parar igual tenga respuesta. No corta un "escribiendo…"
 * en curso: ese tiene su propio vencimiento.
 */
export const MAXIMO_RAFAGA_MS = 20_000;
/**
 * Topes de una ráfaga: un cliente que manda cientos de mensajes seguidos no
 * puede inflar la memoria de la API ni un prompt (que paga el dueño). Al
 * llenarse se contesta lo que hay, y lo que llega mientras esa respuesta sale
 * se descarta pasado el tope. Antes cada mensaje iba por separado.
 */
export const MAX_MENSAJES_RAFAGA = 20;
export const MAX_CARACTERES_RAFAGA = 4_000;

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

/**
 * Veces que se descarta una respuesta a medio armar porque el cliente mandó
 * otro mensaje. Cada vez es una llamada al modelo que paga el dueño; pasado el
 * tope ya no se descarta: lo nuevo espera a que salga esa respuesta.
 */
export const MAX_CANCELACIONES_POR_RAFAGA = 2;

/**
 * Cuánto esperar antes de vaciar una ráfaga: el silencio desde el último
 * mensaje (`ultimo`), sin pasarse del tope desde el primero (`desde`), y
 * además hasta que venza el "escribiendo…" del cliente (`escribiendoHasta`),
 * si hay uno.
 */
export function esperaDeRafaga(desde: number, ultimo: number, ahora: number, escribiendoHasta = 0): number {
  const silencio = Math.min(ultimo + ESPERA_RAFAGA_MS, desde + MAXIMO_RAFAGA_MS);
  return Math.max(0, silencio - ahora, escribiendoHasta - ahora);
}
