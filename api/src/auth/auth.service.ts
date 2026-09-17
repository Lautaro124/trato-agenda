import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
   * Un titular que ya tiene cuenta (típicamente creada con WhatsApp) conecta
   * su Google Calendar. No cambia `calendario`: eso recién pasa cuando la
   * agenda local terminó de copiarse (ver `CalendarService.migrarLocalAGoogle`).
   * El email de Google sólo se adopta si la cuenta no tenía uno y nadie más lo usa.
   */
  async conectarGoogle(userId: string, perfil: PerfilGoogle): Promise<User> {
    const [user, otroPorGoogle, otroPorEmail] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.user.findUnique({ where: { googleId: perfil.googleId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { email: perfil.email }, select: { id: true } }),
    ]);
    if (otroPorGoogle && otroPorGoogle.id !== userId) {
      throw new ConflictException('Esa cuenta de Google ya es de otro usuario de Trato.');
    }
    if (!perfil.refreshToken && !user.googleRefreshToken) {
      throw new UnauthorizedException('Google no devolvió acceso al calendario.');
    }

    const adoptaEmail = !user.email && (!otroPorEmail || otroPorEmail.id === userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        googleId: perfil.googleId,
        ...(adoptaEmail ? { email: perfil.email } : {}),
        name: user.name ?? perfil.name,
        avatarUrl: user.avatarUrl ?? perfil.avatarUrl,
        ...(perfil.refreshToken
          ? { googleRefreshToken: encryptToken(perfil.refreshToken, this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true })) }
          : {}),
      },
    });
  }

  /**
   * Usuario del login de desarrollo: sin refresh token de Google y con la
   * agenda local. Con email se reconoce por el prefijo "dev:" de `googleId`;
   * con teléfono imita una cuenta creada con WhatsApp (sin Google). Nunca pisa
   * a un usuario real: ni uno de Google con ese email ni uno con ese número y
   * una sesión de WhatsApp de verdad.
   */
  async upsertUsuarioDev(email: string, telefono?: string): Promise<User> {
    if (telefono) return this.upsertUsuarioDevPorTelefono(telefono);

    const existente = await this.prisma.user.findUnique({ where: { email } });
    if (existente && !esGoogleIdDev(existente.googleId)) {
      throw new ConflictException('Ese email ya es de un usuario de Google: usá otro para el login de desarrollo.');
    }

    return this.prisma.user.upsert({
      where: { googleId: googleIdDev(email) },
      create: { googleId: googleIdDev(email), email, name: 'Usuario dev', calendario: 'local' },
      update: {},
    });
  }

  private async upsertUsuarioDevPorTelefono(telefono: string): Promise<User> {
    const existente = await this.prisma.user.findUnique({
      where: { phoneNumber: telefono },
      include: { whatsappSession: { select: { registered: true } } },
    });
    if (existente?.whatsappSession?.registered || (existente && existente.googleId && !esGoogleIdDev(existente.googleId))) {
      throw new ConflictException('Ese número ya es de una cuenta real: usá otro para el login de desarrollo.');
    }
    if (existente) {
      const { whatsappSession: _sesion, ...user } = existente;
      return user;
    }
    return this.prisma.user.create({ data: { phoneNumber: telefono, name: 'Usuario dev', calendario: 'local' } });
  }

  /** Usuario de un alta por WhatsApp antes de escanear: sin ninguna identidad todavía. */
  crearAltaPendiente(): Promise<User> {
    return this.prisma.user.create({ data: { calendario: 'local' } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** JWT propio que después viaja en la cookie httpOnly. */
  issueSessionToken(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.signAsync(payload);
  }

  /** Token corto de un paso intermedio (alta por WhatsApp, conectar Google). */
  emitirTokenDePaso(userId: string, tipo: 'alta' | 'conectar', segundos: number): Promise<string> {
    const payload: JwtPayload = { sub: userId, tipo };
    return this.jwt.signAsync(payload, { expiresIn: segundos });
  }

  /**
   * Devuelve el `userId` de un token válido del tipo esperado, o null.
   * `undefined` como tipo es la sesión común.
   */
  async verificarTokenDePaso(token: string | undefined, tipo: JwtPayload['tipo']): Promise<string | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return payload.tipo === tipo ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
