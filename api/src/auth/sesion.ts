import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AgentsService } from '../agents/agents.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { debePonerPassword, type DestinoTrasLogin } from './auth.types.js';
import { nombreCookie, opcionesDeCookie, SIETE_DIAS_MS } from './cookie.js';

/** Deja la cookie de sesión: la usan todas las puertas de entrada. */
export function ponerCookieDeSesion(res: Response, config: ConfigService<Env, true>, token: string): void {
  res.cookie(nombreCookie(config), token, { ...opcionesDeCookie(config), maxAge: SIETE_DIAS_MS });
}

/**
 * Una cuenta de WhatsApp sin contraseña la elige antes que nada (es el paso
 * que sigue al QR). Después, si ya tiene un agente generado no repite el
 * onboarding: va directo a su Home.
 */
export async function destinoTrasLogin(
  agents: Pick<AgentsService, 'findByUserId'>,
  user: Pick<User, 'id' | 'googleId' | 'phoneNumber' | 'passwordHash'>,
): Promise<DestinoTrasLogin> {
  if (debePonerPassword(user)) return '/contrasena';
  return (await agents.findByUserId(user.id)) !== null ? '/inicio' : '/contanos';
}
