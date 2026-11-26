import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { decryptToken } from '../../auth/token-crypto.js';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { EntranteCanal, ReceptorCanal } from '../proveedor/proveedor.js';
import { CloudProveedor, type AltaCloud } from './cloud.proveedor.js';
import { ErrorDeGraph, type GraphClient } from './graph.client.js';

const CLAVE = 'b'.repeat(64);
const ALTA: AltaCloud = { codigo: 'codigo', wabaId: '111', phoneNumberId: '222', coexistencia: true };

function crear(opciones: { filas?: unknown[]; dueno?: { id: string } | null; ocupado?: { userId: string } | null; conversaciones?: unknown[] } = {}) {
  const prisma = {
    cuentaWhatsappCloud: {
      findMany: vi.fn().mockResolvedValue(opciones.filas ?? []),
      findUnique: vi.fn().mockResolvedValue(opciones.ocupado ?? null),
      upsert: vi.fn().mockReturnValue('upsert'),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(opciones.dueno ?? null),
      update: vi.fn().mockReturnValue('update'),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue(opciones.conversaciones ?? []),
      findUnique: vi.fn().mockResolvedValue({ telefono: '5491100000000' }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  const valores: Partial<Env> = { TOKEN_ENCRYPTION_KEY: CLAVE };
  const config = { get: (clave: keyof Env) => valores[clave] } as unknown as ConfigService<Env, true>;
  const graph = {
    configurado: true,
    canjearCodigo: vi.fn().mockResolvedValue('token-del-comercio'),
    numerosDeWaba: vi.fn().mockResolvedValue([{ id: '222', telefono: '+54 9 11 2233-4455' }]),
    registrar: vi.fn().mockResolvedValue(undefined),
    suscribir: vi.fn().mockResolvedValue(undefined),
    desuscribir: vi.fn().mockResolvedValue(undefined),
    enviar: vi.fn().mockResolvedValue('wamid.salida'),
    subirImagen: vi.fn().mockResolvedValue('999'),
    urlDeMedia: vi.fn(),
    descargar: vi.fn(),
  };
  const receptor = {
    recibir: vi.fn().mockResolvedValue(undefined),
    clienteEscribiendo: vi.fn(),
    sesionCerrada: vi.fn(),
    fallo: vi.fn(),
  } satisfies ReceptorCanal;
  const cloud = new CloudProveedor(prisma, config, graph as unknown as GraphClient);
  cloud.escuchar(receptor);
  return { cloud, prisma, graph, receptor };
}

async function conectado() {
  const contexto = crear();
  await contexto.cloud.conectar('user-1', ALTA);
  return contexto;
}

function webhookDeTexto(de = '5491122334455', phoneNumberId = '222') {
  return [
    {
      tipo: 'mensaje' as const,
      phoneNumberId,
      de,
      id: 'wamid.1',
      enviadoEn: 1,
      contenido: { tipo: 'texto' as const, texto: 'Hola' },
      anuncio: null,
    },
  ];
}

describe('CloudProveedor.conectar', () => {
  it('canjea el código, comprueba el número en la WABA, suscribe y guarda el token cifrado', async () => {
    const { cloud, prisma, graph } = crear();
    const status = await cloud.conectar('user-1', ALTA);

    expect(status).toEqual({ linked: true, phoneNumber: '5491122334455' });
    expect(graph.canjearCodigo).toHaveBeenCalledWith('codigo');
    expect(graph.numerosDeWaba).toHaveBeenCalledWith('111', 'token-del-comercio');
    expect(graph.suscribir).toHaveBeenCalledWith('111', 'token-del-comercio');
    // Con Coexistence el número sigue en la app: no se registra.
    expect(graph.registrar).not.toHaveBeenCalled();
    const { create } = vi.mocked(prisma.cuentaWhatsappCloud.upsert).mock.calls[0]![0] as { create: { tokenCifrado: string } };
    expect(create.tokenCifrado).not.toContain('token-del-comercio');
    expect(decryptToken(create.tokenCifrado, CLAVE)).toBe('token-del-comercio');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phoneNumber: '5491122334455' } });
    expect(cloud.sesionVinculada('user-1')).not.toBeNull();
  });

  it('sin Coexistence registra el número con el PIN, y lo exige', async () => {
    const { cloud, graph } = crear();
    await expect(cloud.conectar('user-1', { ...ALTA, coexistencia: false })).rejects.toBeInstanceOf(BadRequestException);
    await cloud.conectar('user-1', { ...ALTA, coexistencia: false, pin: '123456' });
    expect(graph.registrar).toHaveBeenCalledWith('222', 'token-del-comercio', '123456');
  });

  it('rechaza un número que no está en la WABA que ve el token', async () => {
    const { cloud, graph, prisma } = crear();
    graph.numerosDeWaba.mockResolvedValue([{ id: '333', telefono: '5491100000000' }]);
    await expect(cloud.conectar('user-1', ALTA)).rejects.toBeInstanceOf(BadRequestException);
    expect(graph.suscribir).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza un número que ya es la cuenta de otra persona', async () => {
    const { cloud, graph } = crear({ dueno: { id: 'otra' } });
    await expect(cloud.conectar('user-1', ALTA)).rejects.toBeInstanceOf(ConflictException);
    expect(graph.suscribir).not.toHaveBeenCalled();
  });

  it('rechaza ids que no son de Meta sin llamar a Meta', async () => {
    const { cloud, graph } = crear();
    await expect(cloud.conectar('user-1', { ...ALTA, wabaId: '../me' })).rejects.toBeInstanceOf(BadRequestException);
    expect(graph.canjearCodigo).not.toHaveBeenCalled();
  });
});

describe('CloudProveedor.recibirWebhook', () => {
  it('entrega cada mensaje al receptor con el chat existente del cliente', async () => {
    const { cloud, receptor, prisma } = await conectado();
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      { remoteJid: '541122334455@s.whatsapp.net', telefono: null },
    ] as never);
    await cloud.recibirWebhook(webhookDeTexto());

    const [lote] = receptor.recibir.mock.calls[0]! as [EntranteCanal[]];
    expect(lote).toHaveLength(1);
    expect(lote[0]).toMatchObject({
      chat: '541122334455@s.whatsapp.net',
      idExterno: 'wamid.1',
      deMi: false,
      contenido: { tipo: 'texto', texto: 'Hola' },
    });
    expect(lote[0]!.sesion.proveedor).toBe('cloud');
  });

  it('ignora lo que llega para un número que no está conectado', async () => {
    const { cloud, receptor } = await conectado();
    await cloud.recibirWebhook(webhookDeTexto('5491122334455', '999'));
    expect(receptor.recibir).not.toHaveBeenCalled();
  });

  it('el eco de la app del dueño llega como suyo', async () => {
    const { cloud, receptor } = await conectado();
    await cloud.recibirWebhook([
      { tipo: 'eco', phoneNumberId: '222', para: '5491122334455', id: 'wamid.E', enviadoEn: null, texto: 'Ya va' },
    ]);
    const [lote] = receptor.recibir.mock.calls[0]! as [EntranteCanal[]];
    expect(lote[0]).toMatchObject({ deMi: true, chat: '5491122334455@s.whatsapp.net', contenido: { tipo: 'texto', texto: 'Ya va' } });
  });

  it('al desconectar desde Meta borra la cuenta y pide volver a conectar', async () => {
    const { cloud, receptor, prisma } = await conectado();
    await cloud.recibirWebhook([{ tipo: 'desconectado', wabaId: '111' }]);
    expect(cloud.sesionVinculada('user-1')).toBeNull();
    expect(receptor.fallo).toHaveBeenCalledWith('user-1', 'cloud', 'volver_a_vincular');
    expect(prisma.cuentaWhatsappCloud.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', wabaId: '111' } });
  });
});

describe('SesionCloud', () => {
  it('manda texto al número del chat y reconoce su eco', async () => {
    const { cloud, graph } = await conectado();
    const sesion = cloud.sesionVinculada('user-1')!;
    await sesion.enviar('5491122334455@s.whatsapp.net', { texto: 'Hola!' });

    expect(graph.enviar).toHaveBeenCalledWith('222', 'token-del-comercio', {
      recipient_type: 'individual',
      to: '5491122334455',
      type: 'text',
      text: { body: 'Hola!', preview_url: false },
    });
    expect(sesion.esEnviadoPorTrato('wamid.salida')).toBe(true);
  });

  it('a un chat LID le manda al número guardado aparte', async () => {
    const { cloud, graph } = await conectado();
    await cloud.sesionVinculada('user-1')!.enviar('123@lid', { texto: 'Hola' });
    expect(graph.enviar).toHaveBeenCalledWith('222', 'token-del-comercio', expect.objectContaining({ to: '5491100000000' }));
  });

  it('sube la imagen y la manda con su leyenda', async () => {
    const { cloud, graph } = await conectado();
    await cloud.sesionVinculada('user-1')!.enviar('5491122334455@s.whatsapp.net', { imagen: Buffer.from('x'), leyenda: 'Sillón' });
    expect(graph.enviar).toHaveBeenCalledWith(
      '222',
      'token-del-comercio',
      expect.objectContaining({ type: 'image', image: { id: '999', caption: 'Sillón' } }),
    );
  });

  it('un token rechazado pide volver a conectar', async () => {
    const { cloud, graph, receptor } = await conectado();
    graph.enviar.mockRejectedValue(new ErrorDeGraph(401, 190, 'el envío'));
    await expect(cloud.sesionVinculada('user-1')!.enviar('5491122334455@s.whatsapp.net', { texto: 'x' })).rejects.toThrow();
    expect(receptor.fallo).toHaveBeenCalledWith('user-1', 'cloud', 'volver_a_vincular');
  });

  it('deja de ser vigente al desconectar', async () => {
    const { cloud, graph } = await conectado();
    const sesion = cloud.sesionVinculada('user-1')!;
    await cloud.unlink('user-1');
    expect(sesion.vigente()).toBe(false);
    expect(graph.desuscribir).toHaveBeenCalledWith('111', 'token-del-comercio');
  });
});

describe('CloudProveedor.unlink', () => {
  it('no da de baja el webhook de una WABA que usa otro comercio', async () => {
    const { cloud, graph, prisma } = await conectado();
    vi.mocked(prisma.cuentaWhatsappCloud.count).mockResolvedValue(1);
    await cloud.unlink('user-1');
    expect(graph.desuscribir).not.toHaveBeenCalled();
    expect(prisma.cuentaWhatsappCloud.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(cloud.sesionVinculada('user-1')).toBeNull();
  });
});

describe('CloudProveedor.onModuleInit', () => {
  it('carga los números conectados con su token descifrado', async () => {
    const { cloud: previo, prisma } = crear();
    await previo.conectar('user-1', ALTA);
    const { create } = vi.mocked(prisma.cuentaWhatsappCloud.upsert).mock.calls[0]![0] as { create: Record<string, unknown> };
    const { cloud } = crear({ filas: [{ ...create, userId: 'user-1' }] });
    await cloud.onModuleInit();
    expect(await cloud.status('user-1')).toEqual({ linked: true, phoneNumber: '5491122334455' });
  });
});
