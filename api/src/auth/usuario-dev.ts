/**
 * Usuarios del login de desarrollo (`POST /auth/dev/login`) con email. No
 * pasan por Google: se reconocen por el prefijo de `googleId`, que ningún id
 * real de Google puede tener (son numéricos), y así el login dev nunca pisa a
 * un usuario real. Su agenda es la local (`calendario = "local"`).
 */
export const PREFIJO_GOOGLE_ID_DEV = 'dev:';

export const EMAIL_DEV_POR_DEFECTO = 'dev@trato.local';

export function googleIdDev(email: string): string {
  return `${PREFIJO_GOOGLE_ID_DEV}${email}`;
}

export function esGoogleIdDev(googleId: string | null | undefined): boolean {
  return typeof googleId === 'string' && googleId.startsWith(PREFIJO_GOOGLE_ID_DEV);
}
