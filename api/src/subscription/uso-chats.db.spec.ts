/**
 * Conteo de chats del mes contra Postgres real: clientes distintos con mensajes
 * entrantes entre el 1° y fin de mes (hora argentina), sin el chat de prueba
 * del dueño ni los de otras cuentas.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { MercadoPagoClient } from './mercadopago.client.js';
import { SubscriptionService } from './subscription.service.js';

describe.skipIf(!hayBaseDePrueba)('chats del mes (Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cuenta clientes distintos del mes, sin la prueba del dueño, otros meses ni otras cuentas', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const otro = await crearUsuarioDePrueba(prisma);
    const service = new SubscriptionService(
      prisma,
      {} as MercadoPagoClient,
      { get: vi.fn() } as unknown as ConfigService<Env, true>,
      {} as NotificacionesService,
    );
    const ahora = new Date('2026-10-19T15:00:00.000Z');

    async function chat(userId: string, remoteJid: string, mensajes: Array<{ role: string; createdAt: string }>) {
      const conversacion = await prisma.conversation.create({ data: { userId, remoteJid } });
      for (const m of mensajes) {
        await prisma.message.create({
          data: { conversationId: conversacion.id, role: m.role, content: { content: 'x' }, createdAt: new Date(m.createdAt) },
        });
      }
    }

    // Cuenta: dos mensajes del mismo cliente son un solo chat.
    await chat(dueno.id, 'a@s.whatsapp.net', [
      { role: 'user', createdAt: '2026-10-05T12:00:00.000Z' },
      { role: 'user', createdAt: '2026-10-06T12:00:00.000Z' },
    ]);
    // Cuenta: justo después de la medianoche argentina del 1° (03:00 UTC).
    await chat(dueno.id, 'b@s.whatsapp.net', [{ role: 'user', createdAt: '2026-10-01T03:00:00.000Z' }]);
    // No cuentan: mes anterior, sólo respuestas del asistente, el chat de prueba y otra cuenta.
    await chat(dueno.id, 'c@s.whatsapp.net', [{ role: 'user', createdAt: '2026-10-01T02:59:00.000Z' }]);
    await chat(dueno.id, 'd@s.whatsapp.net', [{ role: 'assistant', createdAt: '2026-10-07T12:00:00.000Z' }]);
    await chat(dueno.id, `web-test:${dueno.id}`, [{ role: 'user', createdAt: '2026-10-08T12:00:00.000Z' }]);
    await chat(otro.id, 'a@s.whatsapp.net', [{ role: 'user', createdAt: '2026-10-09T12:00:00.000Z' }]);

    expect(await service.chatsDelMes(dueno.id, ahora)).toBe(2);
    expect(await service.chatsDelMes(otro.id, ahora)).toBe(1);
  });
});
