import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { decryptToken } from './token-crypto.js';

const CLAVE = randomBytes(32).toString('hex');

type Fila = Record<string, unknown> & { id: string };

function crear(filas: Fila[]) {
  const buscar = (where: Record<string, unknown>) =>
    filas.find((f) => Object.entries(where).every(([k, v]) => f[k] === v)) ?? null;
  const prisma = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => buscar(where)),
      findUniqueOrThrow: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => buscar(where)!),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: object }) =>
        Object.assign(buscar(where)!, data),
      ),
      create: vi.fn().mockImplementation(({ data }: { data: object }) => ({ id: 'nuevo', ...data })),
    },
  } as unknown as PrismaService;
  const config = { get: () => CLAVE } as unknown as ConfigService<Env, true>;
  const jwt = {} as JwtService;
  return { service: new AuthService(prisma, jwt, config), prisma };
}

const PERFIL = {
  googleId: 'g-1',
  email: 'titular@gmail.com',
  name: 'Titular',
  avatarUrl: 'https://foto',
  refreshToken: '1//refresh',
};

describe('AuthService.conectarGoogle', () => {
  it('suma Google a una cuenta de WhatsApp: googleId, email, token cifrado; calendario no cambia todavía', async () => {
    const cuenta = { id: 'wa-1', googleId: null, email: null, name: null, avatarUrl: null, googleRefreshToken: null, calendario: 'local' };
    const { service } = crear([cuenta]);

    const user = await service.conectarGoogle('wa-1', PERFIL);

    expect(user).toMatchObject({ googleId: 'g-1', email: 'titular@gmail.com', name: 'Titular', calendario: 'local' });
    expect(decryptToken(user.googleRefreshToken!, CLAVE)).toBe('1//refresh');
  });

  it('409 si esa cuenta de Google ya es de otro usuario', async () => {
    const { service, prisma } = crear([
      { id: 'wa-1', googleId: null, email: null, googleRefreshToken: null },
      { id: 'otro', googleId: 'g-1', email: 'x@gmail.com' },
    ]);

    await expect(service.conectarGoogle('wa-1', PERFIL)).rejects.toThrow('ya es de otro usuario');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('no adopta un email que ya usa otra cuenta, pero conecta igual', async () => {
    const { service } = crear([
      { id: 'wa-1', googleId: null, email: null, googleRefreshToken: null },
      { id: 'otro', googleId: 'g-2', email: 'titular@gmail.com' },
    ]);

    const user = await service.conectarGoogle('wa-1', PERFIL);

    expect(user).toMatchObject({ googleId: 'g-1', email: null });
  });

  it('sin refresh token (ni uno previo) no conecta: no habría acceso al calendario', async () => {
    const { service } = crear([{ id: 'wa-1', googleId: null, email: null, googleRefreshToken: null }]);

    await expect(service.conectarGoogle('wa-1', { ...PERFIL, refreshToken: undefined })).rejects.toThrow(
      'no devolvió acceso',
    );
  });
});

describe('AuthService.upsertUsuarioDev con teléfono', () => {
  it('crea una cuenta tipo WhatsApp con agenda local', async () => {
    const { service, prisma } = crear([]);

    await service.upsertUsuarioDev('dev@trato.local', '5491100000000');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { phoneNumber: '5491100000000', name: 'Usuario dev', calendario: 'local' },
    });
  });

  it('no toma el número de una cuenta con WhatsApp vinculado de verdad', async () => {
    const { service } = crear([
      { id: 'real', phoneNumber: '5491100000000', googleId: null, whatsappSession: { registered: true } },
    ]);

    await expect(service.upsertUsuarioDev('dev@trato.local', '5491100000000')).rejects.toThrow('cuenta real');
  });

  it('reusa el usuario dev de ese número', async () => {
    const { service, prisma } = crear([
      { id: 'dev-tel', phoneNumber: '5491100000000', googleId: null, whatsappSession: null },
    ]);

    const user = await service.upsertUsuarioDev('dev@trato.local', '5491100000000');

    expect(user.id).toBe('dev-tel');
    expect(user).not.toHaveProperty('whatsappSession');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
