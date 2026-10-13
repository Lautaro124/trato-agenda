/**
 * Qué hacer cuando se cae la conexión de WhatsApp, como funciones puras
 * (LAU-18). Antes eran 5 reintentos en unos 30 s y después nada hasta el
 * próximo deploy: un corte de red de un minuto dejaba al bot mudo sin que
 * nadie se enterara.
 */
import { DisconnectReason } from '@whiskeysockets/baileys';

/** Sesiones sin vincular (un QR que nadie escanea): ésas sí se abandonan. */
export const MAX_RECONEXIONES_SIN_VINCULAR = 5;
export const BASE_RECONEXION_MS = 2_000;
/** Techo del backoff: una sesión vinculada nunca espera más que esto entre intentos. */
export const TECHO_RECONEXION_MS = 5 * 60 * 1000;
/**
 * Con `connectionReplaced` otra instancia tomó la sesión, típicamente la vieja
 * durante el solapamiento de un deploy. Se reintenta igual (si no, la nueva
 * quedaba muda hasta el próximo deploy), pero no antes de esto, así dos
 * instancias vivas no se la pasan arrebatando.
 */
export const MINIMO_TRAS_REEMPLAZO_MS = 60 * 1000;
/** `badSession` seguidos que se toleran antes de pedir que vuelvan a vincular. */
export const MAX_SESIONES_MALAS_SEGUIDAS = 5;
/** Cuánto puede estar caída una sesión vinculada antes de avisarle al dueño y a Sentry. */
export const MINUTOS_CAIDO_PARA_AVISAR = 10;

export type AccionDeCierre =
  /** WhatsApp cerró la sesión: se borran las credenciales. */
  | 'desvincular'
  /** El código de vinculación venció antes de que lo ingresaran: no se reconecta. */
  | 'codigo_vencido'
  /** El reinicio que pide Baileys después del pairing: reconectar ya. */
  | 'reiniciar'
  | 'reintentar'
  /** No tiene arreglo reconectando: hay que volver a vincular. */
  | 'rendirse';

export type EstadoAlCerrar = {
  /** Las credenciales del socket ya completaron el pairing (`estaVinculado`). */
  vinculado: boolean;
  /** Se está vinculando por código (ver `WhatsappService.modoCodigo`). */
  modoCodigo: boolean;
  /** Reintentos ya hechos desde la última conexión abierta. */
  intentos: number;
  /** `badSession` seguidos, contando éste. */
  sesionesMalas: number;
};

/** Qué hacer con un cierre de conexión según su código y el estado de la sesión. */
export function politicaDeCierre(codigo: number | undefined, estado: EstadoAlCerrar): AccionDeCierre {
  if (codigo === DisconnectReason.loggedOut) return 'desvincular';
  // Antes que cualquier reintento: reconectar con `me` ya puesto y sin el
  // código confirmado sería un login que no existe.
  if (estado.modoCodigo && !estado.vinculado) return 'codigo_vencido';
  if (codigo === DisconnectReason.restartRequired) return 'reiniciar';
  // Cuenta bloqueada para dispositivos vinculados o sesión de otra versión del protocolo.
  if (codigo === DisconnectReason.forbidden || codigo === DisconnectReason.multideviceMismatch) return 'rendirse';
  if (codigo === DisconnectReason.badSession && estado.sesionesMalas >= MAX_SESIONES_MALAS_SEGUIDAS) return 'rendirse';
  if (estado.vinculado) return 'reintentar';
  return estado.intentos >= MAX_RECONEXIONES_SIN_VINCULAR ? 'rendirse' : 'reintentar';
}

/**
 * Backoff exponencial con jitter ("equal jitter": la mitad fija y la otra
 * mitad al azar, así muchas sesiones caídas a la vez no vuelven todas juntas).
 * `intento` arranca en 1; `azar` en [0, 1).
 */
export function demoraDeReconexion(intento: number, azar: number, codigo?: number): number {
  const exponente = Math.min(Math.max(intento, 1) - 1, 20);
  const tope = Math.min(BASE_RECONEXION_MS * 2 ** exponente, TECHO_RECONEXION_MS);
  const demora = Math.round(tope / 2 + (tope / 2) * azar);
  return codigo === DisconnectReason.connectionReplaced ? Math.max(demora, MINIMO_TRAS_REEMPLAZO_MS) : demora;
}

/** Si una caída que arrancó en `caidoDesde` ya merece avisarle a alguien. */
export function correspondeAvisarCaida(caidoDesde: number, ahora: number): boolean {
  return ahora - caidoDesde >= MINUTOS_CAIDO_PARA_AVISAR * 60 * 1000;
}
