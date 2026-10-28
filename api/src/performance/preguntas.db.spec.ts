/** Clasificación de preguntas contra Postgres real, con un modelo falso: qué chats, una sola vez y aislado por cuenta. */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { MARCA_CLASIFICACION } from './preguntas.rules.js';
import { PreguntasPerformanceService } from './preguntas.service.js';

const AHORA = new Date('2026-10-22T12:00:00-03:00');
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 60 * 60 * 1000);

describe.skipIf(!hayBaseDePrueba)('clasificación de preguntas (Postgres)', () => {
  let prisma: PrismaService;
  let dueno: User;
  let otro: User;
  let numero = 0;
  const chat = vi.fn();
  const conClave = { get: () => 'clave' } as unknown as ConfigService<Env, true>;
  let servicio: PreguntasPerformanceService;
  const cuentas = () => [dueno.id, otro.id];

  /** Un chat de ventas con su EtapaChat y, si se pasan, sus mensajes. */
  async function chatDe(
    userId: string,
    datos: { etapa?: string; quieto: number; mensajes?: Array<[string, string]>; clasificadaAt?: Date; desligado?: boolean },
  ) {
    const conversacion = await prisma.conversation.create({
      data: { userId, remoteJid: `54911${String(++numero).padStart(8, '0')}@s.whatsapp.net` },
    });
    for (const [role, texto] of datos.mensajes ?? [['user', '¿Hacen envíos?']]) {
      await prisma.message.create({ data: { conversationId: conversacion.id, role, content: { content: texto } } });
    }
    return prisma.etapaChat.create({
      data: {
        userId,
        conversationId: datos.desligado ? null : conversacion.id,
        etapa: datos.etapa ?? 'vio_productos',
        ultimaActividadAt: hace(datos.quieto),
        clasificadaAt: datos.clasificadaAt ?? null,
      },
    });
  }

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    servicio = new PreguntasPerformanceService(prisma, { chat } as unknown as OpenRouterClient, conClave);
  });

  beforeEach(async () => {
    chat.mockReset();
    if (dueno) await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('clasifica los chats quietos hace 48 horas o pagados, una sola vez', async () => {
    const quieto = await chatDe(dueno.id, { quieto: 49 });
    const pagado = await chatDe(dueno.id, { quieto: 1, etapa: 'pagado' });
    const activo = await chatDe(dueno.id, { quieto: 3 });
    const yaHecho = await chatDe(dueno.id, { quieto: 100, clasificadaAt: hace(50) });
    const desligado = await chatDe(dueno.id, { quieto: 100, desligado: true });
    chat.mockResolvedValue({ content: '{"preguntas":[]}' });

    expect(await servicio.barrer(AHORA, cuentas())).toBe(2);
    expect(await servicio.barrer(AHORA, cuentas())).toBe(0);

    expect(chat).toHaveBeenCalledTimes(2);
    const clasificadas = await prisma.etapaChat.findMany({
      where: { id: { in: [quieto.id, pagado.id, activo.id, yaHecho.id, desligado.id] } },
      select: { id: true, clasificadaAt: true },
    });
    const marcadas = clasificadas.filter((fila) => fila.clasificadaAt?.getTime() === AHORA.getTime()).map((fila) => fila.id);
    expect(marcadas.sort()).toEqual([quieto.id, pagado.id].sort());
  });

  it('dos pasadas al mismo tiempo no mandan el mismo chat dos veces', async () => {
    await chatDe(dueno.id, { quieto: 72 });
    chat.mockResolvedValue({ content: '{"preguntas":[]}' });
    const otroServicio = new PreguntasPerformanceService(prisma, { chat } as unknown as OpenRouterClient, conClave);

    await Promise.all([servicio.barrer(AHORA, cuentas()), otroServicio.barrer(AHORA, cuentas())]);

    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('guarda las preguntas validadas, con la etapa del chat y sólo productos que vio', async () => {
    const mate = await prisma.producto.create({ data: { userId: dueno.id, codigo: 'MATE', nombre: 'Mate' } });
    const etapa = await chatDe(dueno.id, {
      quieto: 60,
      etapa: 'pedido',
      mensajes: [
        ['user', '¿El mate sale con bombilla? Mi mail es ana@gmail.com'],
        ['assistant', 'Sí, viene con bombilla.'],
        ['user', '¿Envían a Rosario?'],
      ],
    });
    await prisma.interesProducto.create({
      data: { userId: dueno.id, conversationId: etapa.conversationId as string, productoId: mate.id, tipo: 'vio' },
    });
    chat.mockResolvedValue({
      content: JSON.stringify({
        preguntas: [
          { texto: '¿El mate viene con bombilla?', tema: 'stock', productoId: mate.id, resuelta: true },
          { texto: '¿Envían a Rosario?', tema: 'envio', productoId: 'otro-producto', resuelta: false },
        ],
      }),
    });

    await servicio.barrer(AHORA, cuentas());

    const [{ messages }] = chat.mock.calls[0] as [{ messages: Array<{ content: string }> }];
    expect(messages[0].content).toContain(MARCA_CLASIFICACION);
    expect(messages[0].content).toContain(`[${mate.id}] "Mate"`);
    // Al modelo le llega el texto saneado, en orden y como dato.
    expect(messages[1].content).toContain('Cliente: "¿El mate sale con bombilla? Mi mail es […]"');
    expect(messages[1].content).not.toContain('ana@gmail.com');

    const preguntas = await prisma.preguntaChat.findMany({ where: { etapaChatId: etapa.id }, orderBy: { tema: 'asc' } });
    expect(preguntas.map(({ tema, productoId, resuelta, etapa: e, userId }) => ({ tema, productoId, resuelta, e, userId }))).toEqual([
      { tema: 'envio', productoId: null, resuelta: false, e: 'pedido', userId: dueno.id },
      { tema: 'stock', productoId: mate.id, resuelta: true, e: 'pedido', userId: dueno.id },
    ]);
  });

  it('si el modelo falla o contesta cualquier cosa, no reintenta', async () => {
    await chatDe(dueno.id, { quieto: 60 });
    await chatDe(dueno.id, { quieto: 61 });
    chat.mockRejectedValueOnce(new Error('caído')).mockResolvedValueOnce({ content: 'no entendí' });

    expect(await servicio.barrer(AHORA, cuentas())).toBe(0);
    expect(await servicio.barrer(AHORA, cuentas())).toBe(0);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(await prisma.preguntaChat.count({ where: { userId: dueno.id } })).toBe(0);
  });

  it('sin mensajes del cliente no llama al modelo, y sin clave no hace nada', async () => {
    await chatDe(dueno.id, { quieto: 60, mensajes: [['assistant', 'Hola, ¿en qué te ayudo?']] });
    expect(await servicio.barrer(AHORA, cuentas())).toBe(0);
    expect(chat).not.toHaveBeenCalled();

    await chatDe(otro.id, { quieto: 60 });
    const sinClave = new PreguntasPerformanceService(
      prisma,
      { chat } as unknown as OpenRouterClient,
      { get: () => undefined } as unknown as ConfigService<Env, true>,
    );
    expect(await sinClave.barrer(AHORA, cuentas())).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });
});
