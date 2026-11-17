import { ConflictException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MetaWhatsappService } from '../whatsapp/meta/meta-whatsapp.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { AltaMetaService, MAX_ENTRADAS_META_POR_NUMERO_HORA } from './alta-meta.service.js';

const NUMERO = { token: 't', wabaId: 'waba-1', phoneNumberId: 'p-1', telefono: '5491122334455', coexistencia: false };
const DATOS = { code: 'c', wabaId: 'waba-1', phoneNumberId: 'p-1', coexistencia: false };

function crear(existente: object | null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(existente),
      create: vi.fn().mockResolvedValue({ id: 'nuevo' }),
      findUniqueOrThrow: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const meta = { verificar: vi.fn().mockResolvedValue(NUMERO) };
  const whatsapp = { conectarMeta: vi.fn().mockResolvedValue(undefined) };
  const config = { get: () => 'test' } as unknown as ConfigService<Env, true>;
  const service = new AltaMetaService(
    prisma as unknown as PrismaService,
    meta as unknown as MetaWhatsappService,
    whatsapp as unknown as WhatsappService,
    config,
  );
  return { service, prisma, whatsapp };
}

describe('AltaMetaService.entrar', () => {
  it('un número sin cuenta crea una y le conecta WhatsApp Business', async () => {
    const { service, prisma, whatsapp } = crear(null);
    await expect(service.entrar('ip', DATOS)).resolves.toEqual({ id: 'nuevo' });
    expect(prisma.user.create).toHaveBeenCalledWith({ data: { calendario: 'local', phoneNumber: NUMERO.telefono } });
    expect(whatsapp.conectarMeta).toHaveBeenCalledWith('nuevo', NUMERO);
  });

  it('si no se puede conectar, la cuenta recién creada no queda a medias', async () => {
    const { service, prisma, whatsapp } = crear(null);
    whatsapp.conectarMeta.mockRejectedValue(new Error('meta caído'));
    await expect(service.entrar('ip', DATOS)).rejects.toThrow('meta caído');
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'nuevo', googleId: null, passwordHash: null } });
  });

  it('entra a la cuenta que ya estaba conectada a esa misma WABA', async () => {
    const { service, whatsapp } = crear({ id: 'duena', whatsappMeta: { wabaId: 'waba-1' } });
    await expect(service.entrar('ip', DATOS)).resolves.toEqual({ id: 'duena' });
    expect(whatsapp.conectarMeta).toHaveBeenCalledWith('duena', NUMERO);
  });

  it.each([
    ['de Google o QR, sin WhatsApp Business', { id: 'duena', whatsappMeta: null }],
    ['conectada a otra WABA', { id: 'duena', whatsappMeta: { wabaId: 'waba-ajena' } }],
  ])('no abre una cuenta existente %s', async (_caso, existente) => {
    const { service, whatsapp } = crear(existente);
    await expect(service.entrar('ip', DATOS)).rejects.toBeInstanceOf(ConflictException);
    expect(whatsapp.conectarMeta).not.toHaveBeenCalled();
  });

  it('limita los intentos por número', async () => {
    const { service } = crear({ id: 'duena', whatsappMeta: { wabaId: 'waba-1' } });
    for (let i = 0; i < MAX_ENTRADAS_META_POR_NUMERO_HORA; i++) await service.entrar('ip', DATOS);
    await expect(service.entrar('ip', DATOS)).rejects.toBeInstanceOf(HttpException);
  });
});
