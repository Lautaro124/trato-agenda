import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import type { JwtPayload } from './auth.types.js';
import { LoginWhatsappService } from './login-whatsapp.service.js';
import { hashearPassword } from './password.js';

type Incremento = { increment: number };

/** Un solo usuario en memoria; `update`/`updateMany` aplican el `increment` como Postgres. */
async function crear() {
  const user = {
    id: 'user-1',
    email: null,
    phoneNumber: '5491122334455',
    googleId: null,
    passwordHash: await hashearPassword('clave-vieja'),
    sesionVersion: 0,
  } as User;
  const aplicar = (data: { passwordHash?: string; sesionVersion?: Incremento }) => {
    if (data.passwordHash) user.passwordHash = data.passwordHash;
    if (data.sesionVersion) user.sesionVersion += data.sesionVersion.increment;
  };
  const prisma = {
    user: {
      findUnique: ({ where }: { where: { id: string } }) => (where.id === user.id ? { ...user } : null),
      update: ({ data }: { data: Parameters<typeof aplicar>[0] }) => {
        aplicar(data);
        return { ...user };
      },
      updateMany: ({ where, data }: { where: { id: string; sesionVersion: number }; data: Parameters<typeof aplicar>[0] }) => {
        if (where.id !== user.id || where.sesionVersion !== user.sesionVersion) return { count: 0 };
        aplicar(data);
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  const config = {
    get: (clave: string) => ({ SESSION_COOKIE_NAME: 'trato_session', JWT_SECRET: 'secreto-de-prueba', NODE_ENV: 'test' })[clave],
  } as unknown as ConfigService<Env, true>;
  const jwt = new JwtService({ secret: 'secreto-de-prueba', signOptions: { expiresIn: '7d' } });
  const auth = new AuthService(prisma, jwt, config);
  const strategy = new JwtStrategy(config, auth);
  const logins = new LoginWhatsappService(prisma, config);

  /** Lo que haría `JwtAuthGuard` con la cookie: firma + `validate`. */
  const validar = async (token: string) => strategy.validate(await jwt.verifyAsync<JwtPayload>(token));
  const sesion = async () => auth.issueSessionToken((await auth.findById(user.id))!);
  return { auth, jwt, logins, user, validar, sesion };
}

describe('versión de sesión', () => {
  it('una sesión con la versión vigente pasa; con una vieja da 401', async () => {
    const { user, validar, sesion } = await crear();
    const token = await sesion();

    await expect(validar(token)).resolves.toMatchObject({ id: user.id });
    user.sesionVersion = 1;
    await expect(validar(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una sesión anterior a la versión (sin sv) vale como 0 hasta el primer cambio', async () => {
    const { jwt, user, validar } = await crear();
    const vieja = await jwt.signAsync({ sub: user.id, email: null });

    await expect(validar(vieja)).resolves.toMatchObject({ id: user.id });
    user.sesionVersion = 1;
    await expect(validar(vieja)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token de paso nunca vale como sesión', async () => {
    const { auth, user, validar } = await crear();
    const deAlta = await auth.emitirTokenDePaso(user.id, 'alta', 60);

    await expect(validar(deAlta)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.verificarSesion(deAlta)).resolves.toBeNull();
  });

  it('cambiar la contraseña invalida las otras sesiones y la nueva de quien la cambió sigue', async () => {
    const { auth, logins, user, validar, sesion } = await crear();
    const otroDispositivo = await sesion();
    const esteDispositivo = await sesion();

    const actualizado = await logins.cambiarPassword(await validar(esteDispositivo), 'clave-nueva', 'clave-vieja');
    const reemitida = await auth.issueSessionToken(actualizado);

    await expect(validar(otroDispositivo)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(validar(esteDispositivo)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(validar(reemitida)).resolves.toMatchObject({ id: user.id });
  });

  it('recuperar por código (guardar) invalida las sesiones abiertas', async () => {
    const { logins, user, validar, sesion } = await crear();
    const robada = await sesion();

    await logins.guardar(user.id, 'clave-nueva');

    await expect(validar(robada)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout cierra todas las sesiones', async () => {
    const { auth, validar, sesion } = await crear();
    const otroDispositivo = await sesion();
    const esteDispositivo = await sesion();

    await auth.cerrarSesiones(esteDispositivo);

    await expect(validar(otroDispositivo)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(validar(esteDispositivo)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una sesión ya invalidada no puede cerrar las nuevas (no sirve para echar al dueño)', async () => {
    const { auth, user, validar, sesion } = await crear();
    const robada = await sesion();
    await auth.cerrarSesiones(await sesion());
    const nueva = await sesion();

    await auth.cerrarSesiones(robada);
    await auth.cerrarSesiones('basura');
    await auth.cerrarSesiones(undefined);

    expect(user.sesionVersion).toBe(1);
    await expect(validar(nueva)).resolves.toMatchObject({ id: user.id });
  });
});
