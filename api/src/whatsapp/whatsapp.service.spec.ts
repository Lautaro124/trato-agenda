import type { ConfigService } from '@nestjs/config';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImagenesService } from '../comercio/imagenes.service.js';
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

  const conversationService = { responder: vi.fn() } as unknown as ConversationService;
  const subscriptionService = {
    asistenteActivo: vi.fn().mockResolvedValue(true),
  } as unknown as SubscriptionService;
  const imagenes = { paraEnviar: vi.fn() } as unknown as ImagenesService;
  const service = new WhatsappService(prisma, config, conversationService, subscriptionService, imagenes);
  // No queremos que handleConnectionUpdate dispare un makeWASocket real.
  const connectSpy = vi.spyOn(service as never as { connect: () => Promise<void> }, 'connect').mockResolvedValue(undefined);

  const eventos: LinkEvent[] = [];
  service.linkEvents$('user-1').subscribe((mensaje) => eventos.push(mensaje.data as LinkEvent));

  return { service, prisma, connectSpy, eventos, conversationService, subscriptionService, imagenes };
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

describe('WhatsappService — mensajes de clientes', () => {
  const JID = '5491111@s.whatsapp.net';
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Socket con lo que usa una respuesta: mandar, marcar leído y "escribiendo…". */
  function socketDeChat() {
    return {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      readMessages: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    };
  }

  /** Dispara handleMessagesUpsert con un mensaje 1:1 de un cliente. */
  async function recibirMensaje(service: WhatsappService, sock: unknown, texto = 'hola', id = 'm-1') {
    await (
      service as unknown as {
        handleMessagesUpsert: (u: string, s: unknown, e: unknown) => Promise<void>;
      }
    ).handleMessagesUpsert('user-1', sock, {
      type: 'notify',
      messages: [{ key: { remoteJid: JID, fromMe: false, id }, message: { conversation: texto } }],
    });
  }

  it('con la prueba vigente contesta como siempre', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({ texto: '¡Hola!', imagenes: [] });
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(conversationService.responder).toHaveBeenCalledOnce();
    expect(sock.sendMessage).toHaveBeenCalledWith(JID, { text: '¡Hola!' });
  });

  it('espera a que el cliente termine de escribir y contesta la ráfaga entera de una vez', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({ texto: 'Dale, ¿qué día?', imagenes: [] });
    const sock = socketDeChat();

    await recibirMensaje(service, sock, 'hola', 'm-1');
    await vi.advanceTimersByTimeAsync(1_000);
    await recibirMensaje(service, sock, 'quería un turno', 'm-2');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(conversationService.responder).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(conversationService.responder).toHaveBeenCalledOnce();
    expect(conversationService.responder).toHaveBeenCalledWith('user-1', JID, 'hola\nquería un turno');
    expect(sock.readMessages).toHaveBeenCalledWith([
      { remoteJid: JID, fromMe: false, id: 'm-1' },
      { remoteJid: JID, fromMe: false, id: 'm-2' },
    ]);
    expect(sock.sendMessage).toHaveBeenCalledOnce();
  });

  it('muestra "escribiendo…" mientras arma la respuesta y lo apaga al terminar', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({ texto: 'Listo', imagenes: [] });
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    const estados = sock.sendPresenceUpdate.mock.calls.map(([estado]) => estado);
    expect(estados[0]).toBe('composing');
    expect(estados.at(-1)).toBe('paused');
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith('composing', JID);
  });

  it('una respuesta con línea en blanco sale en varios mensajes, en orden', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({
      texto: '¡Qué bueno que escribas!\n\nEl jueves tengo:\n* 10:00\n* 15:00',
      imagenes: [],
    });
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(sock.sendMessage.mock.calls).toEqual([
      [JID, { text: '¡Qué bueno que escribas!' }],
      [JID, { text: 'El jueves tengo:\n* 10:00\n* 15:00' }],
    ]);
  });

  it('lo que llega mientras contesta espera a que termine esa respuesta', async () => {
    const { service, conversationService } = crearServicio();
    let terminarPrimera: (valor: { texto: string; imagenes: [] }) => void = () => undefined;
    vi.mocked(conversationService.responder)
      .mockImplementationOnce(() => new Promise((resolve) => (terminarPrimera = resolve)))
      .mockResolvedValueOnce({ texto: 'Segunda', imagenes: [] });
    const sock = socketDeChat();

    await recibirMensaje(service, sock, 'hola', 'm-1');
    await vi.advanceTimersByTimeAsync(5_000);
    await recibirMensaje(service, sock, 'y otra cosa', 'm-2');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conversationService.responder).toHaveBeenCalledOnce();

    terminarPrimera({ texto: 'Primera', imagenes: [] });
    await vi.runAllTimersAsync();

    expect(conversationService.responder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(conversationService.responder).mock.calls[1][2]).toBe('y otra cosa');
    expect(sock.sendMessage.mock.calls.map(([, contenido]) => contenido)).toEqual([
      { text: 'Primera' },
      { text: 'Segunda' },
    ]);
  });

  it('manda las fotos que eligió el asistente antes del texto', async () => {
    const { service, conversationService, imagenes } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({
      texto: '¿Es lo que buscabas?',
      imagenes: [{ productoId: 'p-1', nombre: 'Mate' }],
    });
    const datos = Buffer.from([0xff, 0xd8, 0xff]);
    vi.mocked(imagenes.paraEnviar).mockResolvedValue({ datos, nombre: 'Mate de calabaza' });
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(imagenes.paraEnviar).toHaveBeenCalledWith('user-1', 'p-1');
    expect(sock.sendMessage.mock.calls).toEqual([
      [JID, { image: datos, mimetype: 'image/jpeg', caption: 'Mate de calabaza' }],
      [JID, { text: '¿Es lo que buscabas?' }],
    ]);
  });

  it('si una foto falla o ya no existe, el texto sale igual', async () => {
    const { service, conversationService, imagenes } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({
      texto: 'Ahí va.',
      imagenes: [
        { productoId: 'p-borrado', nombre: 'Viejo' },
        { productoId: 'p-1', nombre: 'Mate' },
      ],
    });
    vi.mocked(imagenes.paraEnviar).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('se cayó la base'));
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage).toHaveBeenCalledWith(JID, { text: 'Ahí va.' });
  });

  it('vencida: no invoca al grafo, no manda nada ni marca el mensaje como leído', async () => {
    const { service, conversationService, subscriptionService } = crearServicio();
    vi.mocked(subscriptionService.asistenteActivo).mockResolvedValue(false);
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(conversationService.responder).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(sock.readMessages).not.toHaveBeenCalled();
    expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
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
