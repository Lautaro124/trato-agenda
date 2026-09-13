/** Base de la API. En Docker la define docker-compose; el fallback cubre `npm run dev`. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Precio del plan mostrado en la landing (sin sesión). Debe coincidir con SUSCRIPCION_PRECIO_ARS de la API. */
export const PRECIO_ARS = Number(process.env.NEXT_PUBLIC_PRECIO_ARS ?? 20000);

/**
 * Toda llamada a la API va con la cookie de sesión: el JWT vive en `trato_session`,
 * es `httpOnly` y el cliente nunca lo lee, sólo lo manda.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, { ...init, credentials: "include" });
}

/** URL completa para un EventSource: la cookie de sesión viaja con `withCredentials: true`. */
export function sseUrl(path: string): string {
  return `${API_URL}${path}`;
}
