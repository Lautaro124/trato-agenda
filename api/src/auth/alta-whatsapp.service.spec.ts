import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { AltaWhatsappService, MAX_ALTAS_POR_IP_HORA } from './alta-whatsapp.service.js';

type FilaUser = { id: string; googleId: string | null; phoneNumber: string | null; calendario: string };

function crear(
  opciones: {
    sesion?: { registered: boolean; phoneNumber: string | null };
    existentes?: FilaUser[];
    nodeEnv?: string;
  } = {},
) {
  const usuarios = new Map<string, FilaUser>((opciones.existentes ?? []).map((u) => [u.id, u]));
  let siguiente = 1;

  const prisma = {
    user: {
      create: vi.fn().mockImplementation(({ data }: { data: { calendario: string } }) => {
        const user = { id: `alta-${siguiente++}`, googleId: null, phoneNumber: null, ...data };
        usuarios.set(user.id, user);
        return user;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; phoneNumber?: string } }) => {
        if (where.id) return usuarios.get(where.id) ?? null;
        return [...usuarios.values()].find((u) => u.phoneNumber === where.phoneNumber) ?? null;
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<FilaUser> }) =>
        Object.assign(usuarios.get(where.id)!, data),
      ),
      delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => usuarios.delete(where.id)),
      deleteMany: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        usuarios.delete(where.id);
        return { count: 1 };
      }),
    },
    whatsappSession: {
      findUnique: vi.fn().mockResolvedValue(opciones.sesion ?? null),
    },
  } as unknown as PrismaService;

  const whatsapp = {
    startLink: vi.fn().mockResolvedValue(undefined),
    transferirSesion: vi.fn().mockResolvedValue(undefined),
    descartar: vi.fn().mockResolvedValue(undefined),
  } as unknown as WhatsappService;

  const config = { get: () => opciones.nodeEnv ?? 'production' } as unknown as ConfigService<Env, true>;
  const service = new AltaWhatsappService(prisma, whatsapp, config);
  return { service, prisma, whatsapp, usuarios };
}

describe('AltaWhatsappService', () => {
  let service: AltaWhatsappService | undefined;

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;
  });

  it('iniciar crea un usuario sin identidad, con agenda local, y arranca el QR', async () => {
    const creado = crear();
    service = creado.service;

    const user = await service.iniciar('1.1.1.1');

    expect(user).toMatchObject({ googleId: null, phoneNumber: null, calendario: 'local' });
    expect(creado.whatsapp.startLink).toHaveBeenCalledWith(user.id);
  });

  it(`una misma IP no puede arrancar más de ${MAX_ALTAS_POR_IP_HORA} altas por hora`, async () => {
    const creado = crear();
    service = creado.service;

    for (let i = 0; i < MAX_ALTAS_POR_IP_HORA; i++) await service.iniciar('1.1.1.1');

    await expect(service.iniciar('1.1.1.1')).rejects.toThrow('demasiadas altas');
    await expect(service.iniciar('2.2.2.2')).resolves.toBeTruthy();
  });

  it('fuera de producción no limita por IP (los E2E salen todos de localhost)', async () => {
    const creado = crear({ nodeEnv: 'development' });
    service = creado.service;

    for (let i = 0; i <= MAX_ALTAS_POR_IP_HORA; i++) await service.iniciar('127.0.0.1');

    expect(creado.whatsapp.startLink).toHaveBeenCalledTimes(MAX_ALTAS_POR_IP_HORA + 1);
  });

  it('si el QR no arranca, el usuario pendiente no queda', async () => {
    const creado = crear();
    service = creado.service;
    vi.mocked(creado.whatsapp.startLink).mockRejectedValueOnce(new Error('baileys'));

    await expect(service.iniciar('1.1.1.1')).rejects.toThrow('baileys');
    expect(creado.usuarios.size).toBe(0);
  });

  it('finalizar con un número nuevo deja la cuenta con ese número', async () => {
    const creado = crear({ sesion: { registered: true, phoneNumber: '5491100000000' } });
    service = creado.service;
    const pendiente = await service.iniciar('1.1.1.1');

    const user = await service.finalizar(pendiente.id);

    expect(user).toMatchObject({ id: pendiente.id, phoneNumber: '5491100000000' });
    expect(creado.whatsapp.transferirSesion).not.toHaveBeenCalled();
  });

  it('finalizar con un número que ya tiene cuenta entra a esa cuenta y borra el pendiente', async () => {
    const existente = { id: 'cuenta-vieja', googleId: null, phoneNumber: '5491100000000', calendario: 'local' };
    const creado = crear({ sesion: { registered: true, phoneNumber: '5491100000000' }, existentes: [existente] });
    service = creado.service;
    const pendiente = await service.iniciar('1.1.1.1');

    const user = await service.finalizar(pendiente.id);

    expect(user.id).toBe('cuenta-vieja');
    expect(creado.whatsapp.transferirSesion).toHaveBeenCalledWith(pendiente.id, 'cuenta-vieja');
    expect(creado.usuarios.has(pendiente.id)).toBe(false);
  });

  it('finalizar antes de escanear da 409', async () => {
    const creado = crear({ sesion: { registered: false, phoneNumber: null } });
    service = creado.service;
    const pendiente = await service.iniciar('1.1.1.1');

    await expect(service.finalizar(pendiente.id)).rejects.toThrow('Todavía no se vinculó');
  });

  it('abandonar descarta el socket y borra sólo si sigue sin identidad', async () => {
    const creado = crear();
    service = creado.service;
    const pendiente = await service.iniciar('1.1.1.1');
    const conNumero = { id: 'ya-vinculado', googleId: null, phoneNumber: '5491100000000', calendario: 'local' };
    creado.usuarios.set(conNumero.id, conNumero);

    await service.abandonar(pendiente.id);
    await service.abandonar(conNumero.id);

    expect(creado.whatsapp.descartar).toHaveBeenCalledTimes(1);
    expect(creado.usuarios.has(pendiente.id)).toBe(false);
    expect(creado.usuarios.has(conNumero.id)).toBe(true);
  });
});
