import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import type { JwtPayload, PerfilGoogle } from './auth.types.js';
import { encryptToken } from './token-crypto.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Crea o actualiza al usuario que volvió de Google.
   * Google sólo manda refresh_token en el primer consentimiento: si esta vez
   * no vino, se conserva el que ya estaba guardado.
   */
  async validateGoogleUser(perfil: PerfilGoogle): Promise<User> {
    const refreshCifrado = perfil.refreshToken
      ? encryptToken(perfil.refreshToken, this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true }))
      : undefined;

    if (!refreshCifrado) {
      this.logger.warn(
        `Google no devolvió refresh token para ${perfil.email}; se mantiene el anterior si existía.`,
      );
    }

    return this.prisma.user.upsert({
      where: { googleId: perfil.googleId },
      create: {
        googleId: perfil.googleId,
        email: perfil.email,
        name: perfil.name,
        avatarUrl: perfil.avatarUrl,
        googleRefreshToken: refreshCifrado,
      },
      update: {
        email: perfil.email,
        name: perfil.name,
        avatarUrl: perfil.avatarUrl,
        ...(refreshCifrado ? { googleRefreshToken: refreshCifrado } : {}),
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** JWT propio que después viaja en la cookie httpOnly. */
  issueSessionToken(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.signAsync(payload);
  }
}
