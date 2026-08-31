import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';

/** Scope de Calendar: lo pedimos ya en el login porque el bot lo va a necesitar. */
export const GOOGLE_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar',
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
