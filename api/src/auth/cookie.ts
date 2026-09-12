import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import type { Env } from '../config/env.js';

export const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export function nombreCookie(config: ConfigService<Env, true>): string {
  return config.get('SESSION_COOKIE_NAME', { infer: true });
}

/**
 * Opciones de la cookie de sesión, compartidas por el login con Google y el de
 * desarrollo: tienen que coincidir también al borrarla en /auth/logout.
 */
export function opcionesDeCookie(config: ConfigService<Env, true>): CookieOptions {
  const enProduccion = config.get('NODE_ENV', { infer: true }) === 'production';
  return {
    httpOnly: true,
    // 'lax' sólo cuando front y API son el mismo sitio; si no, el browser no
    // manda la cookie en las llamadas del front y /auth/me contesta 401 siempre.
    // Vale la pena intentarlo porque Safari/iOS bloquea las cookies de terceros
    // aunque sean SameSite=None: con 'none' el login ahí no funciona.
    sameSite: mismoSitio(config) ? 'lax' : 'none',
    // 'none' exige secure; en producción va siempre, con 'lax' también.
    secure: enProduccion,
    path: '/',
  };
}

/**
 * ¿El front y la API comparten sitio? Se compara `FRONTEND_URL` con
 * `GOOGLE_CALLBACK_URL`, que es la URL pública de la propia API.
 *
 * A propósito exige una relación real de host padre/hijo (o el mismo host) en
 * vez de comparar "el dominio registrable": `web-production-x.up.railway.app` y
 * `api-production-y.up.railway.app` comparten `railway.app` pero **no** son el
 * mismo sitio (`up.railway.app` está en la Public Suffix List), y darlos por
 * iguales rompería el login sin ningún error visible. Casos que cubre:
 * `tratoagenda.com` + `api.tratoagenda.com` -> sí; `localhost:3000` +
 * `localhost:4000` -> sí (el puerto no cuenta para same-site); dos subdominios
 * hermanos -> no, y cae en 'none', que funciona en todos los browsers menos Safari.
 */
function mismoSitio(config: ConfigService<Env, true>): boolean {
  const front = host(config.get('FRONTEND_URL', { infer: true }));
  const api = host(config.get('GOOGLE_CALLBACK_URL', { infer: true }));
  if (!front || !api) return false;
  if (front === api) return true;
  return front.endsWith(`.${api}`) || api.endsWith(`.${front}`);
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
