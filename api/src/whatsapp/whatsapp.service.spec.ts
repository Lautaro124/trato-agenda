import type { ConfigService } from '@nestjs/config';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { ConversationService } from '../conversation/conversation.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WhatsappService } from './whatsapp.service.js';
import type { LinkEvent } from './whatsapp.types.js';

function crearServicio() {
  const prisma = {
    whatsappSession: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

  const config = {
    get: (clave: string) => (clave === 'NODE_ENV' ? 'test' : 'clave-de-prueba'),
  } as unknown as ConfigService<Env, true>;

  const conversationService = { handleIncoming: vi.fn() } as unknown as ConversationService;
  const service = new WhatsappService(prisma, config, conversationService);
  // No queremos que handleConnectionUpdate dispare un makeWASocket real.
  const connectSpy = vi.spyOn(service as never as { connect: () => Promise<void> }, 'connect').mockResolvedValue(undefined);

  const eventos: LinkEvent[] = [];
  service.linkEvents$('user-1').subscribe((mensaje) => eventos.push(mensaje.data as LinkEvent));

  return { service, prisma, connectSpy, eventos };
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
