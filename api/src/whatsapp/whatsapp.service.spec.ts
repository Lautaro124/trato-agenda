import type { ConfigService } from '@nestjs/config';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { ConversationService } from '../conversation/conversation.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import { WhatsappService } from './whatsapp.service.js';
import type { LinkEvent } from './whatsapp.types.js';

type UsuarioMock = { id: string; googleId: string | null; phoneNumber: string | null };

function crearServicio(usuarios: UsuarioMock[] = []) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; phoneNumber?: string } }) =>
        usuarios.find((u) => (where.id ? u.id === where.id : u.phoneNumber === where.phoneNumber)) ?? null,
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappSession: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        authState: 'blob-cifrado',
        registered: true,
        phoneNumber: '5491100000000',
        linkedAt: null,
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;

  const config = {
    get: (clave: string) => (clave === 'NODE_ENV' ? 'test' : 'clave-de-prueba'),
  } as unknown as ConfigService<Env, true>;

  const conversationService = { handleIncoming: vi.fn() } as unknown as ConversationService;
  const subscriptionService = {
    asistenteActivo: vi.fn().mockResolvedValue(true),
  } as unknown as SubscriptionService;
  const service = new WhatsappService(prisma, config, conversationService, subscriptionService);
  // No queremos que handleConnectionUpdate dispare un makeWASocket real.
  const connectSpy = vi.spyOn(service as never as { connect: () => Promise<void> }, 'connect').mockResolvedValue(undefined);

  const eventos: LinkEvent[] = [];
  service.linkEvents$('user-1').subscribe((mensaje) => eventos.push(mensaje.data as LinkEvent));

  return { service, prisma, connectSpy, eventos, conversationService, subscriptionService };
}

/** Atajo: dispara handleConnectionUpdate como si Baileys hubiera cerrado la conexión. */
function cerrarCon(service: WhatsappService, userId: string, statusCode: number) {
  (service as unknown as { handleConnectionUpdate: (u: string, e: unknown) => void }).handleConnectionUpdate(
    userId,
    { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } },
  );
}

describe('WhatsappService — ramas de handleConnectionUpdate', () => {
  const userId = 'user-1';

  it('loggedOut: borra la sesión guardada y no reconecta', () => {
    const { service, prisma, connectSpy, eventos } = crearServicio();

    cerrarCon(service, userId, DisconnectReason.loggedOut);

    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(connectSpy).not.toHaveBeenCalled();
    expect(eventos).toEqual([{ state: 'error' }]);
  });

  it('restartRequired: reconecta de una, sin tocar el contador de reintentos', () => {
    const { service, connectSpy } = crearServicio();

    cerrarCon(service, userId, DisconnectReason.restartRequired);

    expect(connectSpy).toHaveBeenCalledWith(userId);
    expect((service as unknown as { reconnectAttempts: Map<string, number> }).reconnectAttempts.get(userId)).toBeUndefined();
  });

  it('connectionReplaced: no reconecta en loop, emite error', () => {
    const { service, connectSpy, eventos } = crearServicio();

    cerrarCon(service, userId, DisconnectReason.connectionReplaced);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(eventos).toEqual([{ state: 'error' }]);
  });

  describe('caída recuperable', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reconecta con backoff y respeta MAX_RECONNECT_ATTEMPTS', async () => {
      const { service, connectSpy, eventos } = crearServicio();

      for (let i = 0; i < 5; i++) {
        cerrarCon(service, userId, DisconnectReason.connectionLost);
        await vi.runOnlyPendingTimersAsync();
      }
      expect(connectSpy).toHaveBeenCalledTimes(5);

      // Sexto intento: superó el tope, no reintenta más y avisa al frontend.
      cerrarCon(service, userId, DisconnectReason.connectionLost);
      await vi.runOnlyPendingTimersAsync();

      expect(connectSpy).toHaveBeenCalledTimes(5);
      expect(eventos.at(-1)).toEqual({ state: 'error' });
    });
  });
});

describe('WhatsappService — el asistente calla si venció la suscripción', () => {
  /** Dispara handleMessagesUpsert con un mensaje 1:1 de un cliente. */
  async function recibirMensaje(service: WhatsappService, sock: { sendMessage: unknown }) {
    await (
      service as unknown as {
        handleMessagesUpsert: (u: string, s: unknown, e: unknown) => Promise<void>;
      }
    ).handleMessagesUpsert('user-1', sock, {
      type: 'notify',
      messages: [{ key: { remoteJid: '5491111@s.whatsapp.net', fromMe: false }, message: { conversation: 'hola' } }],
    });
  }

  it('con la prueba vigente contesta como siempre', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.handleIncoming).mockResolvedValue('¡Hola!');
    const sock = { sendMessage: vi.fn() };

    await recibirMensaje(service, sock);

    expect(conversationService.handleIncoming).toHaveBeenCalledOnce();
    expect(sock.sendMessage).toHaveBeenCalledWith('5491111@s.whatsapp.net', { text: '¡Hola!' });
  });

  it('vencida: no invoca al grafo ni manda nada por WhatsApp', async () => {
    const { service, conversationService, subscriptionService } = crearServicio();
    vi.mocked(subscriptionService.asistenteActivo).mockResolvedValue(false);
    const sock = { sendMessage: vi.fn() };

    await recibirMensaje(service, sock);

    expect(conversationService.handleIncoming).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

/** Socket falso con lo que usa el servicio: creds vinculadas y los métodos de cierre. */
function socketFalso(telefono = '5491100000000') {
  return {
    authState: { creds: { me: { id: `${telefono}:3@s.whatsapp.net` } } },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function ponerSocket(service: WhatsappService, userId: string, sock: unknown) {
  (service as unknown as { sockets: Map<string, unknown> }).sockets.set(userId, sock);
}

function abrir(service: WhatsappService, userId: string, sock?: unknown) {
  return (
    service as unknown as { handleConnectionUpdate: (u: string, e: unknown, s?: unknown) => Promise<void> }
  ).handleConnectionUpdate(userId, { connection: 'open' }, sock);
}

describe('WhatsappService — el número vinculado identifica la cuenta', () => {
  it('al conectar guarda el número en el usuario', async () => {
    const { service, prisma, eventos } = crearServicio([{ id: 'user-1', googleId: 'g-1', phoneNumber: null }]);
    ponerSocket(service, 'user-1', socketFalso());

    await abrir(service, 'user-1');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phoneNumber: '5491100000000' } });
    expect(eventos.at(-1)).toEqual({ state: 'connected', phoneNumber: '5491100000000' });
  });

  it('un titular de Google que vincula el número de otra cuenta recibe error y se desvincula', async () => {
    const { service, prisma, eventos } = crearServicio([
      { id: 'user-1', googleId: 'g-1', phoneNumber: null },
      { id: 'otra', googleId: null, phoneNumber: '5491100000000' },
    ]);
    const sock = socketFalso();
    ponerSocket(service, 'user-1', sock);

    await abrir(service, 'user-1');

    expect(eventos.at(-1)).toEqual({ state: 'error', motivo: 'numero_en_uso' });
    expect(sock.logout).toHaveBeenCalled();
    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un alta pendiente con un número que ya tiene cuenta conecta igual: lo resuelve finalizar', async () => {
    const { service, prisma, eventos } = crearServicio([
      { id: 'user-1', googleId: null, phoneNumber: null },
      { id: 'otra', googleId: null, phoneNumber: '5491100000000' },
    ]);
    ponerSocket(service, 'user-1', socketFalso());

    await abrir(service, 'user-1');

    expect(eventos.at(-1)).toEqual({ state: 'connected', phoneNumber: '5491100000000' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('los eventos de un socket que ya no es el del usuario se ignoran', async () => {
    const { service, prisma, eventos } = crearServicio();
    ponerSocket(service, 'user-1', socketFalso());
    const viejo = socketFalso();

    await (
      service as unknown as { handleConnectionUpdate: (u: string, e: unknown, s?: unknown) => Promise<void> }
    ).handleConnectionUpdate(
      'user-1',
      { connection: 'close', lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } } },
      viejo,
    );

    expect(prisma.whatsappSession.deleteMany).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it('enviarAlPropioChat manda al JID del propio número, y sin socket devuelve false', async () => {
    const { service } = crearServicio();
    const sock = socketFalso();

    expect(await service.enviarAlPropioChat('user-1', 'hola')).toBe(false);

    ponerSocket(service, 'user-1', sock);
    expect(await service.enviarAlPropioChat('user-1', 'hola')).toBe(true);
    expect(sock.sendMessage).toHaveBeenCalledWith('5491100000000@s.whatsapp.net', { text: 'hola' });
  });

  it('transferirSesion cierra el socket nuevo sin logout, desloguea el viejo y reconecta con la cuenta', async () => {
    const { service, prisma, connectSpy } = crearServicio();
    const nuevo = socketFalso();
    const viejo = socketFalso();
    ponerSocket(service, 'alta', nuevo);
    ponerSocket(service, 'cuenta', viejo);

    await service.transferirSesion('alta', 'cuenta');

    expect(nuevo.logout).not.toHaveBeenCalled();
    expect(nuevo.end).toHaveBeenCalled();
    expect(viejo.logout).toHaveBeenCalled();
    expect(prisma.whatsappSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'cuenta' },
        update: expect.objectContaining({ authState: 'blob-cifrado' }),
      }),
    );
    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'alta' } });
    expect(connectSpy).toHaveBeenCalledWith('cuenta');
  });
});
