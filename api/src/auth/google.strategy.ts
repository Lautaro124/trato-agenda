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
 * Los scopes tienen que coincidir exactamente con los que figuran en la
 * pantalla de consentimiento de Google Cloud: pedir uno que no está cargado
 * ahí (pasó con `calendar.events` y `calendar.freebusy`) hace que Google
 * muestre la app como no verificada y bloquee el login.
 *
 * - `auth/calendar` es el único scope sensible configurado en la consola.
 *   Cubre todas las llamadas que hacemos (`events.insert`, `patch`, `delete`
 *   y `list`), incluida la disponibilidad, que sale de `events.list`
 *   (`CalendarService.freeBusy`) con un `fields` acotado a horarios y estado.
 *   `calendar.app.created` no alcanza: la disponibilidad tiene que contar
 *   también los eventos que el titular cargó a mano.
 *
 * Cambiar esta lista obliga a cambiar la consola de Google en el mismo
 * momento, y a todos los usuarios a consentir de nuevo.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar',
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
