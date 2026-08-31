import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, AuthGuardAuthenticateOptions } from '@nestjs/passport';
import type { AuthenticateOptionsGoogle } from 'passport-google-oauth20';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  /**
   * `accessType: offline` + `prompt: consent` son lo único que hace que Google
   * devuelva refresh token, y sin eso no podemos tocar el calendario después.
   */
  getAuthenticateOptions(_context: ExecutionContext): AuthGuardAuthenticateOptions {
    const opciones: AuthenticateOptionsGoogle = { accessType: 'offline', prompt: 'consent' };
    return opciones as AuthGuardAuthenticateOptions;
  }
}
