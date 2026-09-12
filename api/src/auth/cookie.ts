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
    // En producción el front y la API viven en dominios distintos
    // (*.up.railway.app está en la Public Suffix List, así que ni siquiera son
    // el mismo sitio): con 'lax' el browser no manda la cookie en las llamadas
    // del front y /auth/me contesta 401 siempre. 'none' exige secure, que ahí ya está.
    // Contra conocida: Safari/iOS bloquea las cookies de terceros aunque sean
    // SameSite=None, así que el login falla en ese browser hasta que front y API
    // compartan dominio (subdominios propios, o un rewrite /api/* en Next).
    sameSite: enProduccion ? 'none' : 'lax',
    secure: enProduccion,
    path: '/',
  };
}
