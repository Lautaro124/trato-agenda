import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { decryptToken } from '../../auth/token-crypto.js';
import type { Env } from '../../config/env.js';
import type { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MetaGraphError, type MetaGraphClient } from './meta-graph.client.js';
import { MetaWhatsappService, type NumeroVerificado } from './meta-whatsapp.service.js';

const CLAVE = 'a'.repeat(64);
const NUMERO: NumeroVerificado = {
  token: 'token-del-negocio',
  wabaId: '1029384756',
  phoneNumberId: '5647382910',
  telefono: '5491100000000',
  coexistencia: false,
};

function crear({ dueno = null as { id: string } | null, otroMeta = null as { userId: string } | null } = {}) {
  const filas = new Map<string, Record<string, unknown>>();
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(dueno),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappMeta: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { userId?: string; phoneNumberId?: string } }) => {
        if (where.phoneNumberId) return Promise.resolve(otroMeta);
        return Promise.resolve(filas.get(where.userId!) ?? null);
      }),
      findMany: vi.fn().mockImplementation(() => Promise.resolve([...filas.values()])),
      upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
        filas.set(create.userId as string, create);
        return Promise.resolve(create);
      }),
      deleteMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        filas.delete(where.userId);
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: vi.fn().mockImplementation((operaciones: Promise<unknown>[]) => Promise.all(operaciones)),
  };
  const valores: Record<string, string> = { TOKEN_ENCRYPTION_KEY: CLAVE };
  const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
  const graph = {
    configurado: true,
    canjearCodigo: vi.fn().mockResolvedValue(NUMERO.token),
    numeroDeWaba: vi.fn().mockResolvedValue({ id: NUMERO.phoneNumberId, telefono: NUMERO.telefono }),
    suscribirApp: vi.fn().mockResolvedValue(undefined),
    desuscribirApp: vi.fn().mockResolvedValue(undefined),
    registrarNumero: vi.fn().mockResolvedValue(undefined),
    iniciarSincronizacion: vi.fn().mockResolvedValue(undefined),
    enviarTexto: vi.fn().mockResolvedValue(undefined),
    enviarImagen: vi.fn().mockResolvedValue(undefined),
    leidoYEscribiendo: vi.fn().mockResolvedValue(undefined),
  };
  const notificaciones = { avisar: vi.fn().mockResolvedValue(null) };
  const service = new MetaWhatsappService(
    prisma as unknown as PrismaService,
    config,
    graph as unknown as MetaGraphClient,
    notificaciones as unknown as NotificacionesService,
  );
  return { service, prisma, graph, notificaciones, filas };
}

const SIGNUP = { code: 'codigo', wabaId: NUMERO.wabaId, phoneNumberId: NUMERO.phoneNumberId, coexistencia: false };

describe('MetaWhatsappService.verificar', () => {
  it('canjea el código y confirma el número contra la WABA', async () => {
    const { service, graph } = crear();
    await expect(service.verificar(SIGNUP)).resolves.toEqual(NUMERO);
    expect(graph.numeroDeWaba).toHaveBeenCalledWith(NUMERO.token, NUMERO.wabaId, NUMERO.phoneNumberId);
  });

  it('un número que no es de esa WABA no pasa', async () => {
    const { service, graph } = crear();
    graph.numeroDeWaba.mockResolvedValue(null);
    await expect(service.verificar(SIGNUP)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un error de Meta (código vencido) es un 502 sin el cuerpo de Meta', async () => {
    const { service, graph } = crear();
    graph.canjearCodigo.mockRejectedValue(new MetaGraphError('canjear el código', 400, 100));
    await expect(service.verificar(SIGNUP)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('MetaWhatsappService.activar', () => {
  it('suscribe la app, registra el número y guarda el token cifrado', async () => {
    const { service, graph, prisma, filas } = crear();
    await service.activar('user-1', NUMERO);

    expect(graph.suscribirApp).toHaveBeenCalledWith(NUMERO.token, NUMERO.wabaId);
    expect(graph.registrarNumero).toHaveBeenCalledWith(NUMERO.token, NUMERO.phoneNumberId);
    expect(graph.iniciarSincronizacion).not.toHaveBeenCalled();
    const fila = filas.get('user-1')!;
    expect(fila.accessToken).not.toBe(NUMERO.token);
    expect(decryptToken(fila.accessToken as string, CLAVE)).toBe(NUMERO.token);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phoneNumber: NUMERO.telefono } });
    await expect(service.conexionDe('user-1')).resolves.toMatchObject({ token: NUMERO.token, telefono: NUMERO.telefono });
  });

  it('en coexistencia no registra: pide la sincronización', async () => {
    const { service, graph } = crear();
    await service.activar('user-1', { ...NUMERO, coexistencia: true });
    expect(graph.iniciarSincronizacion).toHaveBeenCalledWith(NUMERO.token, NUMERO.phoneNumberId);
    expect(graph.registrarNumero).not.toHaveBeenCalled();
  });

  it('un número de otra cuenta es 409 y no toca Meta', async () => {
    const { service, graph } = crear({ dueno: { id: 'otra' } });
    await expect(service.activar('user-1', NUMERO)).rejects.toBeInstanceOf(ConflictException);
    expect(graph.suscribirApp).not.toHaveBeenCalled();
  });

  it('el mismo phone_number_id conectado a otra cuenta también es 409', async () => {
    const { service } = crear({ otroMeta: { userId: 'otra' } });
    await expect(service.activar('user-1', NUMERO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('si Meta no deja activarlo no se guarda nada', async () => {
    const { service, graph, filas } = crear();
    graph.registrarNumero.mockRejectedValue(new MetaGraphError('registrar el número', 400));
    await expect(service.activar('user-1', NUMERO)).rejects.toBeInstanceOf(BadGatewayException);
    expect(filas.size).toBe(0);
  });
});

describe('MetaWhatsappService.salida', () => {
  it('manda al wa_id del chat y deja de ser vigente al desconectar', async () => {
    const { service, graph } = crear();
    await service.activar('user-1', NUMERO);
    const conexion = (await service.conexionDe('user-1'))!;
    const salida = service.salida(conexion, 'wamid.1');

    await salida.enviarTexto('5491122334455@s.whatsapp.net', 'Hola');
    expect(graph.enviarTexto).toHaveBeenCalledWith(NUMERO.token, NUMERO.phoneNumberId, '5491122334455', 'Hola');
    expect(salida.ventana24h).toBe(true);
    expect(salida.vigente()).toBe(true);

    await service.desconectar('user-1');
    expect(graph.desuscribirApp).toHaveBeenCalledWith(NUMERO.token, NUMERO.wabaId);
    expect(salida.vigente()).toBe(false);
    await expect(service.conexionDe('user-1')).resolves.toBeNull();
  });

  it('no manda a un chat que no es de un número', async () => {
    const { service } = crear();
    await service.activar('user-1', NUMERO);
    const salida = service.salida((await service.conexionDe('user-1'))!);
    await expect(salida.enviarTexto('123-456@g.us', 'Hola')).rejects.toThrow();
  });

  it('"escribiendo…" va atado al último mensaje del cliente', async () => {
    vi.useFakeTimers();
    try {
      const { service, graph } = crear();
      await service.activar('user-1', NUMERO);
      const conexion = (await service.conexionDe('user-1'))!;
      const escribiendo = service.salida(conexion, 'wamid.9').escribiendo('5491122334455@s.whatsapp.net');
      expect(graph.leidoYEscribiendo).toHaveBeenCalledWith(NUMERO.token, NUMERO.phoneNumberId, 'wamid.9', true);
      escribiendo.parar();
      graph.leidoYEscribiendo.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(graph.leidoYEscribiendo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MetaWhatsappService.darDeBaja', () => {
  it('borra la conexión de esa WABA y avisa en el panel', async () => {
    const { service, notificaciones } = crear();
    await service.activar('user-1', NUMERO);
    await service.darDeBaja(NUMERO.wabaId);
    await expect(service.conexionDe('user-1')).resolves.toBeNull();
    expect(notificaciones.avisar).toHaveBeenCalledWith('user-1', expect.objectContaining({ tipo: 'whatsapp_desconectado' }));
  });
});
