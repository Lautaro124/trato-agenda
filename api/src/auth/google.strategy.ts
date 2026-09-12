import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';

/**
 * Los scopes son el mínimo que la app usa de verdad, y eso es deliberado: la
 * verificación de Google rechaza pedir más de lo que se puede justificar.
 *
 * - `calendar.events` cubre las cuatro llamadas de eventos que hacemos
 *   (insert, patch, delete, list). `calendar.app.created` no alcanza: la
 *   disponibilidad tiene que contar también los eventos que el titular cargó
 *   a mano, que esa variante no deja ver.
 * - `calendar.freebusy` es lo único que necesita `freebusy.query`, que es la
 *   única lectura del calendario en el flujo de clientes.
 *
 * Antes se pedía `auth/calendar` entero (lectura y escritura de todos los
 * calendarios, ACLs y settings). No volver a ampliarlo sin justificarlo ante
 * Google: cambiar esta lista obliga a todos los usuarios a consentir de nuevo.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: GOOGLE_SCOPES,
    });
  }

  async validate(
    _accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new UnauthorizedException('La cuenta de Google no expuso un email.'), false);
      return;
    }

    try {
      const user = await this.authService.validateGoogleUser({
        googleId: profile.id,
        email,
        name: profile.displayName ?? null,
        avatarUrl: profile.photos?.[0]?.value ?? null,
        refreshToken,
      });
      done(null, user);
    } catch (error) {
      done(error as Error, false);
    }
  }
}
