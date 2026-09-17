import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import type { JwtPayload } from './auth.types.js';
import type { User } from '../generated/prisma/client.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    const cookieName = config.get('SESSION_COOKIE_NAME', { infer: true });

    super({
      // La sesión viaja en cookie httpOnly, no en el header Authorization.
      jwtFromRequest: (req: Request): string | null =>
        (req.cookies as Record<string, string> | undefined)?.[cookieName] ?? null,
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    // Los tokens de un paso intermedio van en otras cookies, pero se firman con
    // el mismo secreto: si alguien copia uno a la de sesión, no vale.
    if (payload.tipo) {
      throw new UnauthorizedException('Ese token no es una sesión.');
    }
    const user = await this.authService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('La sesión apunta a un usuario que ya no existe.');
    }
    return user;
  }
}
