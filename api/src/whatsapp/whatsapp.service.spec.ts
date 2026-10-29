import type { ConfigService } from '@nestjs/config';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImagenesService } from '../comercio/imagenes.service.js';
import type { Env } from '../config/env.js';
import { Cancelacion, VueltaCancelada } from '../conversation/cancelacion.js';
import type { ConversationService } from '../conversation/conversation.service.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import { MAX_RECONEXIONES_SIN_VINCULAR, MINIMO_TRAS_REEMPLAZO_MS, MINUTOS_CAIDO_PARA_AVISAR } from './reconexion.js';
import { ESPERA_RAFAGA_MS } from './ritmo-humano.js';
import {
  AVISO_FUERA_DE_HORARIO,
  MAX_CODIGOS_POR_CUENTA,
  MAX_CODIGOS_POR_NUMERO_HORA,
  NAVEGADOR_WHATSAPP,
  WhatsappService,
} from './whatsapp.service.js';
import type { LinkEvent } from './whatsapp.types.js';
import type { PedidosAMedidaService } from '../comercio/pedidos-a-medida.service.js';
import type { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';

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
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        authState: 'blob-cifrado',
        registered: true,
        phoneNumber: '5491100000000',
        linkedAt: null,
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    whatsappClave: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversation: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  } as unknown as PrismaService;
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: PrismaService) => Promise<unknown>) => fn(prisma)) as never);

  const config = {
    get: (clave: string) => (clave === 'NODE_ENV' ? 'test' : 'clave-de-prueba'),
  } as unknown as ConfigService<Env, true>;

  const conversationService = { responder: vi.fn() } as unknown as ConversationService;
  const subscriptionService = {
    asistenteActivo: vi.fn().mockResolvedValue(true),
    avisarSiLlegaAlTope: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubscriptionService;
  const imagenes = { paraEnviar: vi.fn() } as unknown as ImagenesService;
  const notificaciones = { avisar: vi.fn().mockResolvedValue(null) } as unknown as NotificacionesService;
  const pedidos = {
    enAtencionHumana: vi.fn().mockResolvedValue(false),
    guardarMensajeEnPausa: vi.fn().mockResolvedValue(undefined),
  };
  const horarioAtencion = { atencion: vi.fn().mockResolvedValue('atender') };
  const service = new WhatsappService(
    prisma,
    config,
    conversationService,
    subscriptionService,
    imagenes,
    notificaciones,
    pedidos as unknown as PedidosAMedidaService,
    horarioAtencion as unknown as HorarioAtencionService,
  );
  // No queremos que handleConnectionUpdate dispare un makeWASocket real.
  const connectSpy = vi.spyOn(service as never as { connect: () => Promise<void> }, 'connect').mockResolvedValue(undefined);

  const eventos: LinkEvent[] = [];
  service.linkEvents$('user-1').subscribe((mensaje) => eventos.push(mensaje.data as LinkEvent));

  return {
    service,
    prisma,
    connectSpy,
    eventos,
    conversationService,
    subscriptionService,
    imagenes,
    notificaciones,
    pedidos,
    horarioAtencion,
  };
}

/** Atajo: dispara handleConnectionUpdate como si Baileys hubiera cerrado la conexión. */
function cerrarCon(service: WhatsappService, userId: string, statusCode: number, sock?: unknown) {
  return (
    service as unknown as { handleConnectionUpdate: (u: string, e: unknown, s?: unknown) => Promise<void> }
  ).handleConnectionUpdate(userId, { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } }, sock);
}

/** Como `cerrarCon`, pero con el socket vivo de una sesión ya vinculada (como tras un reinicio). */
function cerrarVinculada(service: WhatsappService, userId: string, statusCode: number) {
  const sock = { authState: { creds: { me: { id: '5491100000000:3@s.whatsapp.net' } } } };
  (service as unknown as { sockets: Map<string, unknown> }).sockets.set(userId, sock);
  return cerrarCon(service, userId, statusCode, sock);
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

  it('connectionReplaced: reintenta, pero no antes de un minuto (sin pelearse con otra instancia)', async () => {
    vi.useFakeTimers();
    try {
      const { service, connectSpy, eventos } = crearServicio();

      await cerrarCon(service, userId, DisconnectReason.connectionReplaced);
      await vi.advanceTimersByTimeAsync(MINIMO_TRAS_REEMPLAZO_MS - 1);
      expect(connectSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(connectSpy).toHaveBeenCalledWith(userId);
      expect(eventos).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('caída recuperable', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sin vincular (un QR que nadie escanea): reintenta con backoff y se rinde a los MAX_RECONEXIONES_SIN_VINCULAR', async () => {
      const { service, connectSpy, eventos } = crearServicio();

      for (let i = 0; i < MAX_RECONEXIONES_SIN_VINCULAR; i++) {
        await cerrarCon(service, userId, DisconnectReason.connectionLost);
        await vi.runOnlyPendingTimersAsync();
      }
      expect(connectSpy).toHaveBeenCalledTimes(MAX_RECONEXIONES_SIN_VINCULAR);

      // Uno más: superó el tope, no reintenta más y avisa al frontend.
      await cerrarCon(service, userId, DisconnectReason.connectionLost);
      await vi.runOnlyPendingTimersAsync();

      expect(connectSpy).toHaveBeenCalledTimes(MAX_RECONEXIONES_SIN_VINCULAR);
      expect(eventos.at(-1)).toEqual({ state: 'error' });
    });

    it('vinculada: sigue reintentando sin tope mientras la sesión siga registrada', async () => {
      const { service, prisma, connectSpy, eventos } = crearServicio();
      vi.mocked(prisma.whatsappSession.findUnique).mockResolvedValue({ registered: true } as never);

      for (let i = 0; i < 12; i++) {
        await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
        await vi.runOnlyPendingTimersAsync();
      }

      expect(connectSpy).toHaveBeenCalledTimes(12);
      expect(eventos).toEqual([]);
    });

    it('vinculada y caída más de MINUTOS_CAIDO_PARA_AVISAR: avisa al dueño una sola vez', async () => {
      const { service, prisma, notificaciones } = crearServicio();
      vi.mocked(prisma.whatsappSession.findUnique).mockResolvedValue({ registered: true } as never);

      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
      await vi.advanceTimersByTimeAsync((MINUTOS_CAIDO_PARA_AVISAR - 1) * 60_000);
      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
      expect(notificaciones.avisar).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);

      expect(notificaciones.avisar).toHaveBeenCalledOnce();
      expect(notificaciones.avisar).toHaveBeenCalledWith(userId, expect.objectContaining({ tipo: 'whatsapp_desconectado' }));
    });

    it('si se desvincula mientras espera el reintento, no la revive', async () => {
      const { service, connectSpy } = crearServicio();

      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
      await service.unlink(userId);
      await vi.runOnlyPendingTimersAsync();

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('si al reintentar la sesión ya no está registrada en la base, no reconecta', async () => {
      const { service, connectSpy } = crearServicio();

      await cerrarVinculada(service, userId, DisconnectReason.connectionLost);
      await vi.runOnlyPendingTimersAsync();

      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  it('forbidden con una sesión vinculada: se rinde, la marca sin vincular y le pide al dueño volver a vincular', async () => {
    const { service, prisma, connectSpy, eventos, notificaciones } = crearServicio();

    await cerrarVinculada(service, userId, DisconnectReason.forbidden);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(prisma.whatsappSession.updateMany).toHaveBeenCalledWith({ where: { userId }, data: { registered: false } });
    expect(prisma.whatsappSession.deleteMany).not.toHaveBeenCalled();
    expect(notificaciones.avisar).toHaveBeenCalledWith(userId, expect.objectContaining({ enlace: '/vincular' }));
    expect(eventos).toEqual([{ state: 'error' }]);
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

  it('en un chat en atención humana no contesta, no marca leído y guarda el mensaje (LAU-27)', async () => {
    const { service, conversationService, pedidos } = crearServicio();
    pedidos.enAtencionHumana.mockResolvedValue(true);
    const sock = socketDeChat();

    await recibirMensaje(service, sock, '¿me pasás el precio?');
    await vi.runAllTimersAsync();

    expect(conversationService.responder).not.toHaveBeenCalled();
    expect(sock.readMessages).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(pedidos.guardarMensajeEnPausa).toHaveBeenCalledWith('user-1', JID, '¿me pasás el precio?', 'cliente');
  });

  it('si el chat pasó a una persona mientras esperaba la ráfaga, no manda nada', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder).mockResolvedValue({ texto: '', imagenes: [], enAtencionHumana: true });
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it('guarda lo que el dueño contesta desde su teléfono sólo en un chat en atención humana', async () => {
    const { service, pedidos } = crearServicio();
    const sock = { ...socketDeChat(), authState: { creds: {} } };
    const delDueno = (id: string) =>
      (service as unknown as { handleMessagesUpsert: (u: string, s: unknown, e: unknown) => Promise<void> }).handleMessagesUpsert(
        'user-1',
        sock,
        { type: 'notify', messages: [{ key: { remoteJid: JID, fromMe: true, id }, message: { conversation: 'Te lo hago en roble' } }] },
      );

    await delDueno('d-1');
    expect(pedidos.guardarMensajeEnPausa).not.toHaveBeenCalled();

    pedidos.enAtencionHumana.mockResolvedValue(true);
    await delDueno('d-2');
    expect(pedidos.guardarMensajeEnPausa).toHaveBeenCalledWith('user-1', JID, 'Te lo hago en roble', 'dueno');
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
    expect(conversationService.responder).toHaveBeenCalledWith('user-1', JID, 'hola\nquería un turno', {
      cancelacion: expect.any(Cancelacion),
    });
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
    await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
    await recibirMensaje(service, sock, 'y otra cosa', 'm-2');
    await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
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

  it('si llega otro mensaje mientras se arma la respuesta, la descarta y contesta todo junto', async () => {
    const { service, conversationService } = crearServicio();
    vi.mocked(conversationService.responder)
      .mockImplementationOnce(
        (_u, _j, _t, opciones) =>
          new Promise((_resolve, reject) =>
            opciones?.cancelacion?.signal.addEventListener('abort', () => reject(new VueltaCancelada())),
          ),
      )
      .mockResolvedValueOnce({ texto: 'Te contesto las dos cosas', imagenes: [] });
    const sock = socketDeChat();

    await recibirMensaje(service, sock, 'hola', 'm-1');
    await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
    expect(conversationService.responder).toHaveBeenCalledOnce();

    await recibirMensaje(service, sock, 'y otra cosa', 'm-2');
    await vi.runAllTimersAsync();

    expect(conversationService.responder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(conversationService.responder).mock.calls[1][2]).toBe('hola\ny otra cosa');
    expect(sock.sendMessage.mock.calls.map(([, contenido]) => contenido)).toEqual([{ text: 'Te contesto las dos cosas' }]);
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

    expect(imagenes.paraEnviar).toHaveBeenCalledWith('user-1', 'p-1', undefined);
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

  it('fuera del horario de atención: silencio, sin grafo ni leído ni "escribiendo…"', async () => {
    const { service, conversationService, horarioAtencion } = crearServicio();
    horarioAtencion.atencion.mockResolvedValue('ignorar');
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(horarioAtencion.atencion).toHaveBeenCalledWith('user-1', JID, expect.any(Date));
    expect(conversationService.responder).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(sock.readMessages).not.toHaveBeenCalled();
    expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
  });

  it('fuera del horario de atención, un chat ya iniciado recibe el aviso y nada más', async () => {
    const { service, conversationService, horarioAtencion } = crearServicio();
    horarioAtencion.atencion.mockResolvedValue('avisar');
    const sock = socketDeChat();

    await recibirMensaje(service, sock);
    await vi.runAllTimersAsync();

    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    expect(sock.sendMessage).toHaveBeenCalledWith(JID, { text: AVISO_FUERA_DE_HORARIO });
    expect(conversationService.responder).not.toHaveBeenCalled();
    expect(sock.readMessages).not.toHaveBeenCalled();
    expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
  });

  it('si el aviso no sale, no rompe la recepción', async () => {
    const { service, conversationService, horarioAtencion } = crearServicio();
    horarioAtencion.atencion.mockResolvedValue('avisar');
    const sock = socketDeChat();
    sock.sendMessage.mockRejectedValue(new Error('socket caído'));

    await expect(recibirMensaje(service, sock)).resolves.not.toThrow();
    await vi.runAllTimersAsync();

    expect(conversationService.responder).not.toHaveBeenCalled();
  });

  it('vencida: ni siquiera consulta el horario', async () => {
    const { service, subscriptionService, horarioAtencion } = crearServicio();
    vi.mocked(subscriptionService.asistenteActivo).mockResolvedValue(false);

    await recibirMensaje(service, socketDeChat());
    await vi.runAllTimersAsync();

    expect(horarioAtencion.atencion).not.toHaveBeenCalled();
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

  it('lo que manda queda a mano para reenviarlo si el cliente pide reenvío (getMessage)', async () => {
    const { service } = crearServicio();
    const sock = socketFalso();
    sock.sendMessage.mockResolvedValue({ key: { id: 'MSG-1' }, message: { conversation: 'hola' } });
    ponerSocket(service, 'user-1', sock);

    await service.enviarAlCliente('user-1', '5491111@s.whatsapp.net', 'hola');

    const enviados = (service as unknown as { enviados: { buscar: (u: string, id: string) => unknown } }).enviados;
    expect(enviados.buscar('user-1', 'MSG-1')).toEqual({ conversation: 'hola' });
    expect(enviados.buscar('otra-cuenta', 'MSG-1')).toBeUndefined();

    // Lo del chat propio (códigos de acceso, avisos) no queda en memoria.
    sock.sendMessage.mockResolvedValue({ key: { id: 'MSG-2' }, message: { conversation: '123456' } });
    await service.enviarAlPropioChat('user-1', '123456');
    expect(enviados.buscar('user-1', 'MSG-2')).toBeUndefined();
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
    expect(prisma.whatsappClave.deleteMany).toHaveBeenCalledWith({ where: { userId: 'cuenta' } });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'alta' } });
    expect(connectSpy).toHaveBeenCalledWith('cuenta');
  });
});

describe('WhatsappService — vincular con código desde el mismo celular', () => {
  type Interno = { modoCodigo: Set<string>; esperandoQr: Map<unknown, () => void> };
  const interno = (service: WhatsappService) => service as unknown as Interno;

  /** Un socket recién creado, todavía sin vincular, que sabe pedir código. */
  function socketSinVincular() {
    return {
      authState: { creds: {} as Record<string, unknown> },
      requestPairingCode: vi.fn().mockResolvedValue('ABCD1234'),
      sendMessage: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('con un WhatsApp ya vinculado contesta 409 y no abre otro socket', async () => {
    const { service, connectSpy } = crearServicio();
    ponerSocket(service, 'user-1', socketFalso());

    await expect(service.pedirCodigo('user-1', '5491122334455')).rejects.toMatchObject({ status: 409 });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('espera a que el socket hable con WhatsApp y pide el código con el número como lo registra WhatsApp', async () => {
    const { service, prisma, connectSpy } = crearServicio();
    const sock = socketSinVincular();
    connectSpy.mockImplementation(async () => ponerSocket(service, 'user-1', sock));

    // Escrito sin el 9: WhatsApp lo tiene registrado con el 9.
    const pedido = service.pedirCodigo('user-1', '541122334455');
    await vi.waitFor(() => expect(interno(service).esperandoQr.size).toBe(1));
    expect(sock.requestPairingCode).not.toHaveBeenCalled();

    await (
      service as unknown as { handleConnectionUpdate: (u: string, e: unknown, s?: unknown) => Promise<void> }
    ).handleConnectionUpdate('user-1', { qr: 'ref,clave' }, sock);

    await expect(pedido).resolves.toBe('ABCD-1234');
    expect(sock.requestPairingCode).toHaveBeenCalledWith('5491122334455');
    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', registered: false } });
    expect(interno(service).modoCodigo.has('user-1')).toBe(true);
  });

  it('con la sesión vinculada en la base contesta 409 aunque no haya socket (reconectando)', async () => {
    const { service, prisma, connectSpy } = crearServicio();
    vi.mocked(prisma.whatsappSession.findUnique).mockResolvedValue({ registered: true } as never);

    await expect(service.pedirCodigo('user-1', '5491122334455')).rejects.toMatchObject({ status: 409 });
    expect(connectSpy).not.toHaveBeenCalled();
    expect(prisma.whatsappSession.deleteMany).not.toHaveBeenCalled();
  });

  it('limita los códigos por número, aunque se escriba de distintas formas y desde distintas cuentas', async () => {
    const { service } = crearServicio();
    const formas = ['5491122334455', '541122334455', '+54 9 11 2233-4455'];

    // Sin socket, cada pedido falla con 503, pero igual cuenta para el límite.
    for (let i = 0; i < MAX_CODIGOS_POR_NUMERO_HORA; i++) {
      await expect(service.pedirCodigo(`user-${i}`, formas[i % formas.length]!)).rejects.toMatchObject({ status: 503 });
    }
    await expect(service.pedirCodigo('otra', '5491122334455')).rejects.toMatchObject({ status: 429 });
  });

  it('limita los códigos por cuenta, aunque cada uno sea para un número distinto', async () => {
    const { service } = crearServicio();

    for (let i = 0; i < MAX_CODIGOS_POR_CUENTA; i++) {
      await expect(service.pedirCodigo('user-1', `54911223344${10 + i}`)).rejects.toMatchObject({ status: 503 });
    }
    await expect(service.pedirCodigo('user-1', '5491199998888')).rejects.toMatchObject({ status: 429 });
  });

  it('un segundo pedido mientras el primero sigue en curso contesta 409', async () => {
    const { service, connectSpy } = crearServicio();
    const sock = socketSinVincular();
    connectSpy.mockImplementation(async () => ponerSocket(service, 'user-1', sock));

    const primero = service.pedirCodigo('user-1', '5491122334455');
    await expect(service.pedirCodigo('user-1', '5491122334455')).rejects.toMatchObject({ status: 409 });

    await vi.waitFor(() => expect(interno(service).esperandoQr.size).toBe(1));
    await (
      service as unknown as { handleConnectionUpdate: (u: string, e: unknown, s?: unknown) => Promise<void> }
    ).handleConnectionUpdate('user-1', { qr: 'ref,clave' }, sock);
    await expect(primero).resolves.toBe('ABCD-1234');
  });

  it('si se corta con el código pendiente no reconecta: avisa que venció', () => {
    const { service, prisma, connectSpy, eventos } = crearServicio();
    const sock = socketSinVincular();
    sock.authState.creds = { me: { id: '5491122334455@s.whatsapp.net' }, pairingCode: 'ABCD1234', registered: false };
    ponerSocket(service, 'user-1', sock);
    interno(service).modoCodigo.add('user-1');

    cerrarCon(service, 'user-1', DisconnectReason.timedOut);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', registered: false } });
    expect(eventos.at(-1)).toEqual({ state: 'expired' });
  });

  it('con el código ya confirmado, el restartRequired reconecta como con el QR', () => {
    const { service, connectSpy } = crearServicio();
    const sock = socketSinVincular();
    sock.authState.creds = { me: { id: '5491122334455:3@s.whatsapp.net' }, pairingCode: 'ABCD1234', registered: true };
    ponerSocket(service, 'user-1', sock);
    interno(service).modoCodigo.add('user-1');

    cerrarCon(service, 'user-1', DisconnectReason.restartRequired);

    expect(connectSpy).toHaveBeenCalledWith('user-1');
  });

  it('volver al QR arranca de cero: borra lo que quedó sin vincular', async () => {
    const { service, prisma, connectSpy } = crearServicio();
    interno(service).modoCodigo.add('user-1');

    await service.startLink('user-1');

    expect(prisma.whatsappSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', registered: false } });
    expect(interno(service).modoCodigo.has('user-1')).toBe(false);
    expect(connectSpy).toHaveBeenCalledWith('user-1');
  });
});

describe('NAVEGADOR_WHATSAPP', () => {
  it('es un navegador real con versión fija: con un nombre propio WhatsApp rechaza el código de vinculación', () => {
    const [sistema, navegador, version] = NAVEGADOR_WHATSAPP;
    expect(navegador).toBe('Chrome');
    expect(sistema).toBe('Ubuntu');
    expect(version).toMatch(/^\d+(\.\d+)+$/);
  });
});
