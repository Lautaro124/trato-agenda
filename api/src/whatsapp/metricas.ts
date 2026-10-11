/**
 * Tiempos de WhatsApp como funciones puras, para medir antes de optimizar
 * (LAU-11). Todo lo que sale de acá va a los logs con el prefijo
 * `PREFIJO_TIEMPOS`, que es como se filtra en Railway, y lleva sólo ids y
 * números: nunca el JID del cliente (es su teléfono) ni el texto.
 */

/** Lo que se busca en los logs de Railway para ver los tiempos. */
export const PREFIJO_TIEMPOS = 'Tiempos WhatsApp';

/** Cada cuántos guardados de la sesión se loguea el resumen. */
export const CADA_CUANTOS_GUARDADOS = 100;
/** Un guardado más lento que esto se loguea en el momento, sin esperar al resumen. */
export const GUARDADO_LENTO_MS = 500;

export type TiemposDeRafaga = {
  /**
   * Del timestamp que puso WhatsApp al primer mensaje hasta que Baileys nos lo
   * entregó. Es lo que mide el buffer de eventos de Baileys (hasta 30 s después
   * de conectar). `null` si el mensaje no traía timestamp.
   */
  entregaMs: number | null;
  /** De que llegó el primer mensaje a que se empezó a contestar: la espera de ráfaga. */
  esperaMs: number;
  /** Lo que tardó el grafo (modelo + herramientas). */
  modeloMs: number;
  /** Fotos + partes del texto, con las demoras de tipeo incluidas. */
  envioMs: number;
  mensajes: number;
  partes: number;
};

/** La línea de log de una ráfaga contestada. */
export function resumenDeRafaga(userId: string, t: TiemposDeRafaga): string {
  const total = (t.entregaMs ?? 0) + t.esperaMs + t.modeloMs + t.envioMs;
  const entrega = t.entregaMs === null ? '?' : String(t.entregaMs);
  return (
    `${PREFIJO_TIEMPOS} · ráfaga de ${userId}: entrega=${entrega}ms espera=${t.esperaMs}ms ` +
    `modelo=${t.modeloMs}ms envio=${t.envioMs}ms total=${total}ms ` +
    `(mensajes=${t.mensajes}, partes=${t.partes})`
  );
}

/**
 * `messageTimestamp` de Baileys viene en segundos, como número o como Long de
 * protobuf. Devuelve milisegundos, o `null` si no hay uno usable.
 */
export function timestampEnMs(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const segundos = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null;
}

/**
 * Cuánto tardó en llegarnos un mensaje desde que WhatsApp lo fechó. Nunca
 * negativo: el reloj del servidor y el nuestro no están sincronizados al
 * milisegundo y el timestamp tiene resolución de segundos.
 */
export function demoraDeEntrega(enviadoEnMs: number | null, recibidoEnMs: number): number | null {
  if (enviadoEnMs === null) return null;
  return Math.max(0, recibidoEnMs - enviadoEnMs);
}

/**
 * Acumula los guardados de la sesión de Baileys (`saveCreds` y cada
 * `keys.set`, ver whatsapp-auth-state.ts) y dice cuándo loguear: cada
 * `CADA_CUANTOS_GUARDADOS`, o enseguida si uno fue lento. Desde LAU-18 cada
 * guardado escribe sólo las filas que cambiaron, así que `filas` y el tamaño
 * tienen que quedar chicos aunque la sesión crezca.
 */
export class MedidorDeGuardados {
  private cantidad = 0;
  private sumaMs = 0;
  private maximoMs = 0;
  private maximoFilas = 0;
  private maximoBytes = 0;

  constructor(private readonly userId: string) {}

  /** Devuelve la línea a loguear, o null si todavía no toca. */
  registrar(serializarMs: number, escribirMs: number, filas: number, bytes: number): string | null {
    const ms = serializarMs + escribirMs;
    this.cantidad += 1;
    this.sumaMs += ms;
    this.maximoMs = Math.max(this.maximoMs, ms);
    this.maximoFilas = Math.max(this.maximoFilas, filas);
    this.maximoBytes = Math.max(this.maximoBytes, bytes);

    if (ms > GUARDADO_LENTO_MS) {
      return (
        `${PREFIJO_TIEMPOS} · guardado lento de la sesión de ${this.userId}: ` +
        `serializar=${serializarMs}ms escribir=${escribirMs}ms filas=${filas} tamaño=${Math.round(bytes / 1024)}KB`
      );
    }
    if (this.cantidad < CADA_CUANTOS_GUARDADOS) return null;

    const linea =
      `${PREFIJO_TIEMPOS} · sesión de ${this.userId}: ${this.cantidad} guardados, ` +
      `promedio=${Math.round(this.sumaMs / this.cantidad)}ms maximo=${this.maximoMs}ms ` +
      `filas_max=${this.maximoFilas} tamaño_max=${Math.round(this.maximoBytes / 1024)}KB`;
    this.cantidad = 0;
    this.sumaMs = 0;
    this.maximoMs = 0;
    this.maximoFilas = 0;
    this.maximoBytes = 0;
    return linea;
  }
}
