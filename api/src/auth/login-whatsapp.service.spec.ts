import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LoginWhatsappService, MAX_INTENTOS_POR_NUMERO } from './login-whatsapp.service.js';
import * as password from './password.js';

const TELEFONO = '5491122334455';

async function crear(opciones: { passwordHash?: string | null; hayUsuario?: boolean } = {}) {
  const hash = opciones.passwordHash === undefined ? await password.hashearPassword('clave-correcta') : opciones.passwordHash;
  const user = { id: 'user-1', phoneNumber: TELEFONO, googleId: null, passwordHash: hash } as User;
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue(opciones.hayUsuario === false ? [] : [user]),
      update: vi.fn().mockImplementation(({ data }: { data: Partial<User> }) => ({ ...user, ...data })),
    },
  } as unknown as PrismaService;
  const config = { get: () => 'development' } as unknown as ConfigService<Env, true>;
  return { service: new LoginWhatsappService(prisma, config), prisma, user };
}

describe('LoginWhatsappService.entrar', () => {
  it('con la contraseña correcta devuelve la cuenta', async () => {
    const { service } = await crear();

    await expect(service.entrar(TELEFONO, 'clave-correcta', 'ip')).resolves.toMatchObject({ id: 'user-1' });
  });

  it('contraseña mala, número sin cuenta y cuenta sin contraseña dan el mismo 401', async () => {
    const mala = await crear();
    const sinCuenta = await crear({ hayUsuario: false });
    const sinPassword = await crear({ passwordHash: null });

    const mensajes = await Promise.all([
      mala.service.entrar(TELEFONO, 'otra-clave', 'ip').catch((e: Error) => e.message),
      sinCuenta.service.entrar(TELEFONO, 'clave-correcta', 'ip').catch((e: Error) => e.message),
      sinPassword.service.entrar(TELEFONO, 'clave-correcta', 'ip').catch((e: Error) => e.message),
    ]);
    expect(new Set(mensajes)).toEqual(new Set(['El número o la contraseña no son correctos.']));
  });

  it('sin cuenta igual corre scrypt contra HASH_FALSO (mismo tiempo)', async () => {
    const espia = vi.spyOn(password, 'passwordCorrecta');
    const { service } = await crear({ hayUsuario: false });

    await service.entrar(TELEFONO, 'x', 'ip').catch(() => undefined);

    expect(espia).toHaveBeenCalledWith('x', password.HASH_FALSO);
    espia.mockRestore();
  });

  it(`corta con 429 después de ${MAX_INTENTOS_POR_NUMERO} intentos al mismo número`, async () => {
    const { service } = await crear();
    for (let i = 0; i < MAX_INTENTOS_POR_NUMERO; i++) {
      await service.entrar(TELEFONO, 'mala-clave', 'ip').catch(() => undefined);
    }

    await expect(service.entrar(TELEFONO, 'clave-correcta', 'ip')).rejects.toThrow('Demasiados intentos');
  });
});

describe('LoginWhatsappService.cambiarPassword', () => {
  it('una cuenta sin contraseña la pone sin pedir la actual', async () => {
    const { service, prisma, user } = await crear({ passwordHash: null });

    await service.cambiarPassword(user, 'nueva-clave');

    const hash = vi.mocked(prisma.user.update).mock.calls[0][0].data.passwordHash as string;
    expect(await password.passwordCorrecta('nueva-clave', hash)).toBe(true);
  });

  it('con contraseña exige la actual correcta (403 si no)', async () => {
    const { service, prisma, user } = await crear();

    await expect(service.cambiarPassword(user, 'nueva-clave')).rejects.toThrow('actual no es correcta');
    await expect(service.cambiarPassword(user, 'nueva-clave', 'mala')).rejects.toThrow('actual no es correcta');
    expect(prisma.user.update).not.toHaveBeenCalled();

    await service.cambiarPassword(user, 'nueva-clave', 'clave-correcta');
    expect(prisma.user.update).toHaveBeenCalledOnce();
  });

  it('una cuenta sin WhatsApp no puede tener contraseña', async () => {
    const { service, user } = await crear({ passwordHash: null });

    await expect(service.cambiarPassword({ ...user, phoneNumber: null }, 'nueva-clave')).rejects.toThrow(
      'no tiene uno vinculado',
    );
  });
});
