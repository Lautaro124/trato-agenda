import type { ConfigService } from '@nestjs/config';
import { google, type calendar_v3 } from 'googleapis';
import { decryptToken } from '../auth/token-crypto.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';

/** Se lanza cuando no se puede armar/usar un cliente de Calendar para un usuario. */
export class CalendarUnavailableError extends Error {}

/**
 * Arma un cliente de Google Calendar autenticado para un usuario a partir de
 * su refresh token cifrado. `googleapis` refresca el access token solo en
 * cada llamada (no hay que cachearlo ni persistirlo) — esto reemplaza el
 * "access-token refresh simulado" que mencionaba CLAUDE.md.
 */
export function getCalendarClient(
  user: Pick<User, 'googleRefreshToken'>,
  config: ConfigService<Env, true>,
): calendar_v3.Calendar {
  if (!user.googleRefreshToken) {
    throw new CalendarUnavailableError(
      'El usuario no tiene un refresh token de Google guardado; no se puede acceder a su Calendar.',
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(
      user.googleRefreshToken,
      config.get('TOKEN_ENCRYPTION_KEY', { infer: true }),
    );
  } catch (error) {
    throw new CalendarUnavailableError(
      `No se pudo descifrar el refresh token de Google: ${(error as Error).message}`,
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    config.get('GOOGLE_CLIENT_ID', { infer: true }),
    config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}
