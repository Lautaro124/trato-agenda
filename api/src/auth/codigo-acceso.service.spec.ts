import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { CodigoAccesoService, MAX_INTENTOS_POR_CODIGO, mensajeConCodigo } from './codigo-acceso.service.js';

type FilaCodigo = { id: string; userId: string; hash: string; expiraAt: Date; intentos: number; createdAt: Date };

const TELEFONO = '5491122334455';

function crear(opciones: { nodeEnv?: string; socketVivo?: boolean; hayUsuario?: boolean } = {}) {
  let codigos: FilaCodigo[] = [];
  const prisma = {
    user: {
      // La búsqueda prueba varias formas del mismo número: alcanza con que una sea la del usuario.
      findMany: vi.fn().mockImplementation(({ where }: { where: { phoneNumber: { in: string[] } } }) =>
        opciones.hayUsuario !== false && where.phoneNumber.in.includes(TELEFONO)
          ? [{ id: 'user-1', phoneNumber: TELEFONO }]
          : [],
      ),
    },
    codigoAcceso: {
      deleteMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        codigos = codigos.filter((c) => c.userId !== where.userId);
        return { count: 0 };
      }),
      create: vi.fn().mockImplementation(({ data }: { data: Omit<FilaCodigo, 'id' | 'intentos' | 'createdAt'> }) => {
        const fila = { ...data, id: `c${codigos.length + 1}`, intentos: 0, createdAt: new Date() };
        codigos.push(fila);
        return fila;
      }),
      findFirst: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) =>
        codigos.filter((c) => c.userId === where.userId).at(-1) ?? null,
      ),
      update: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const fila = codigos.find((c) => c.id === where.id)!;
        fila.intentos++;
        return fila;
      }),
    },
  } as unknown as PrismaService;

  const enviados: string[] = [];
  const whatsapp = {
    enviarAlPropioChat: vi.fn().mockImplementation((_userId: string, texto: string) => {
      if (!opciones.socketVivo) return Promise.resolve(false);
      enviados.push(texto);
      return Promise.resolve(true);
    }),
  } as unknown as WhatsappService;

  const config = {
    get: () => opciones.nodeEnv ?? 'development',
  } as unknown as ConfigService<Env, true>;

  const service = new CodigoAccesoService(prisma, whatsapp, config);
  const pedir = async (ip = '1.1.1.1') => {
    service.solicitar(TELEFONO, ip);
    await service.pendiente;
  };
  const codigoEnviado = () => enviados.at(-1)!.match(/\d{6}/)![0];

  return { service, prisma, whatsapp, pedir, codigoEnviado, filas: () => codigos };
}

describe('CodigoAccesoService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('manda el código al chat propio y guarda sólo el hash', async () => {
    const { pedir, whatsapp, codigoEnviado, filas } = crear({ socketVivo: true });

    await pedir();

    expect(whatsapp.enviarAlPropioChat).toHaveBeenCalledWith('user-1', expect.stringContaining('Trato Agenda'));
    expect(filas()).toHaveLength(1);
    expect(filas()[0].hash).not.toContain(codigoEnviado());
    expect(filas()[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con el código correcto entra una sola vez', async () => {
    const { service, pedir, codigoEnviado } = crear({ socketVivo: true });
    await pedir();
    const codigo = codigoEnviado();

    await expect(service.verificar(TELEFONO, codigo)).resolves.toMatchObject({ id: 'user-1' });
    await expect(service.verificar(TELEFONO, codigo)).rejects.toThrow('no es válido');
  });

  it('vence a los 10 minutos', async () => {
    const { service, pedir, codigoEnviado } = crear({ socketVivo: true });
    await pedir();

    vi.setSystemTime(new Date('2026-09-17T12:10:00Z'));
    await expect(service.verificar(TELEFONO, codigoEnviado())).rejects.toThrow('no es válido');
  });

  it(`después de ${MAX_INTENTOS_POR_CODIGO} intentos fallidos ni el correcto sirve`, async () => {
    const { service, pedir, codigoEnviado } = crear({ socketVivo: true });
    await pedir();
    const correcto = codigoEnviado();
    const incorrecto = correcto === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_INTENTOS_POR_CODIGO; i++) {
      await expect(service.verificar(TELEFONO, incorrecto)).rejects.toThrow('no es válido');
    }
    await expect(service.verificar(TELEFONO, correcto)).rejects.toThrow('no es válido');
  });

  it('un número sin cuenta no genera nada y el pedido no falla', async () => {
    const { pedir, prisma, whatsapp } = crear({ socketVivo: true, hayUsuario: false });

    await expect(pedir()).resolves.toBeUndefined();
    expect(prisma.codigoAcceso.create).not.toHaveBeenCalled();
    expect(whatsapp.enviarAlPropioChat).not.toHaveBeenCalled();
  });

  it('un segundo pedido para el mismo número dentro del minuto da 429', async () => {
    const { service, pedir } = crear({ socketVivo: true });
    await pedir();

    expect(() => service.solicitar(TELEFONO, '2.2.2.2')).toThrow('Esperá');
  });

  it('en producción sin socket vivo no deja un código que nadie puede recibir', async () => {
    const { service, pedir, filas } = crear({ nodeEnv: 'production' });

    await pedir();

    expect(filas()).toHaveLength(0);
    expect(service.ultimoCodigoDev(TELEFONO)).toBeNull();
  });

  it('fuera de producción sin socket el código queda para /auth/dev/ultimo-codigo', async () => {
    const { service, pedir } = crear();

    await pedir();
    const codigo = service.ultimoCodigoDev(TELEFONO);

    expect(codigo).toMatch(/^\d{6}$/);
    await expect(service.verificar(TELEFONO, codigo!)).resolves.toMatchObject({ id: 'user-1' });
    expect(service.ultimoCodigoDev(TELEFONO)).toBeNull();
  });

  it('el mensaje dice cuánto dura el código', () => {
    expect(mensajeConCodigo('123456')).toContain('123456');
    expect(mensajeConCodigo('123456')).toContain('10 minutos');
  });
});
