import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, AuthGuardAuthenticateOptions } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticateOptionsGoogle } from 'passport-google-oauth20';
import type { ResultadoConexionGoogle } from '../google.strategy.js';

export type RequestConConexion = Request & { conexionGoogle?: ResultadoConexionGoogle };

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

  /** Deja a mano del controller el resultado de conectar Google a una cuenta. */
  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: { conexion?: ResultadoConexionGoogle } | undefined,
    context: ExecutionContext,
  ): TUser {
    context.switchToHttp().getRequest<RequestConConexion>().conexionGoogle = info?.conexion;
    return super.handleRequest(err, user, info, context);
  }
}
