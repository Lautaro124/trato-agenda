import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import type { JwtPayload, PerfilGoogle } from './auth.types.js';
import { encryptToken } from './token-crypto.js';
import { esGoogleIdDev, googleIdDev } from './usuario-dev.js';

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
      // Se loguea el googleId y no el email: es igual de útil para depurar y
      // no deja datos de la cuenta de Google en los logs.
      this.logger.warn(
        `Google no devolvió refresh token para ${perfil.googleId}; se mantiene el anterior si existía.`,
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

  /**
   * Usuario del login de desarrollo: sin refresh token de Google, con un
   * `googleId` que CalendarService reconoce para usar el calendario falso.
   * Nunca pisa a un usuario real que ya entró con Google con ese email.
   */
  async upsertUsuarioDev(email: string): Promise<User> {
    const existente = await this.prisma.user.findUnique({ where: { email } });
    if (existente && !esGoogleIdDev(existente.googleId)) {
      throw new ConflictException('Ese email ya es de un usuario de Google: usá otro para el login de desarrollo.');
    }

    return this.prisma.user.upsert({
      where: { googleId: googleIdDev(email) },
      create: { googleId: googleIdDev(email), email, name: 'Usuario dev' },
      update: {},
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
