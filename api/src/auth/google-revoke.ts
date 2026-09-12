/**
 * Revocación del refresh token de Google.
 *
 * No se usa `googleapis` a propósito: es un POST a un endpoint público que no
 * necesita cliente OAuth armado, y el resto del proyecto llama a servicios
 * externos con `fetch` pelado (ver `agents/openrouter.client.ts` y
 * `subscription/mercadopago.client.ts`).
 *
 * Nunca lanza. Revocar es parte del borrado de cuenta, y un token que el
 * usuario ya revocó a mano desde su cuenta de Google devuelve 400: eso no
 * puede dejar a la persona sin poder borrar sus datos.
 */
const URL_REVOCACION = 'https://oauth2.googleapis.com/revoke';
const TIMEOUT_MS = 10_000;

export async function revocarTokenDeGoogle(refreshToken: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(URL_REVOCACION, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
