import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { nombreCookie } from './cookie.js';
import { COOKIE_CONECTAR } from './cookies-de-paso.js';

/**
 * Qué pasó en el callback cuando se estaba conectando Google a una cuenta
 * existente (`undefined` si fue un login común). Viaja como `info` de Passport
 * y GoogleAuthGuard lo deja en la request.
 */
export type ResultadoConexionGoogle = 'conectado' | 'google_en_uso';

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
    private readonly config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: GOOGLE_SCOPES,
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
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

    const perfil = {
      googleId: profile.id,
      email,
      name: profile.displayName ?? null,
      avatarUrl: profile.photos?.[0]?.value ?? null,
      refreshToken,
    };

    try {
      // Con la cookie de "conectar" no es un login: es una cuenta existente
      // (típicamente de WhatsApp) sumando su Google Calendar. Tiene que
      // coincidir con la sesión viva: si en el medio se entró con otra cuenta
      // en este navegador, el Google no se pega a la anterior.
      const cookies = req.cookies as Record<string, string> | undefined;
      const [userId, sesion] = await Promise.all([
        this.authService.verificarTokenDePaso(cookies?.[COOKIE_CONECTAR], 'conectar'),
        this.authService.verificarTokenDePaso(cookies?.[nombreCookie(this.config)], undefined),
      ]);
      if (userId && userId === sesion) {
        try {
          const user = await this.authService.conectarGoogle(userId, perfil);
          done(null, user, { conexion: 'conectado' satisfies ResultadoConexionGoogle });
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          const user = await this.authService.findById(userId);
          done(null, user ?? false, { conexion: 'google_en_uso' satisfies ResultadoConexionGoogle });
        }
        return;
      }

      done(null, await this.authService.validateGoogleUser(perfil));
    } catch (error) {
      done(error as Error, false);
    }
  }
}
