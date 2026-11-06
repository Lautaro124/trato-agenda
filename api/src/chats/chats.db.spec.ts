/**
 * Chats contra Postgres real (LAU-81): el trigger que mantiene
 * `ultimoMensajeAt`, las consultas crudas de la lista, el aislamiento por
 * dueño, la devolución que arrastra los pedidos derivados y la idempotencia
 * de los mensajes del panel.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { ChatsService } from './chats.service.js';

function crearWhatsapp() {
  return {
    interrumpir: vi.fn(),
    contestarPendientes: vi.fn().mockResolvedValue(true),
    enviarDesdePanel: vi.fn().mockResolvedValue(true),
  };
}

describe.skipIf(!hayBaseDePrueba)('ChatsService (Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function chatCon(userId: string, remoteJid: string, mensajes: Array<{ role: string; content: object; createdAt: Date }>) {
    const conversation = await prisma.conversation.create({ data: { userId, remoteJid } });
    for (const mensaje of mensajes) await prisma.message.create({ data: { conversationId: conversation.id, ...mensaje } });
    return conversation;
  }

  it('lista los chats del dueño por último mensaje, sin el banco de pruebas ni chats de otros', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const otro = await crearUsuarioDePrueba(prisma);
    const viejo = await chatCon(dueno.id, '5491100000001@s.whatsapp.net', [
      { role: 'user', content: { content: 'hola' }, createdAt: new Date('2026-11-01T10:00:00Z') },
    ]);
    const nuevo = await chatCon(dueno.id, '5491100000002@s.whatsapp.net', [
      { role: 'user', content: { content: '¿tenés turno?' }, createdAt: new Date('2026-11-02T10:00:00Z') },
      { role: 'assistant', content: { content: '', tool_calls: [{ id: 't', name: 'x', arguments: '{}' }] }, createdAt: new Date('2026-11-02T10:00:01Z') },
      { role: 'assistant', content: { content: 'Sí, el jueves.' }, createdAt: new Date('2026-11-02T10:00:02Z') },
    ]);
    await chatCon(dueno.id, `web-test:${dueno.id}`, [{ role: 'user', content: { content: 'prueba' }, createdAt: new Date() }]);
    await chatCon(otro.id, '5491100000003@s.whatsapp.net', [{ role: 'user', content: { content: 'ajeno' }, createdAt: new Date() }]);

    const service = new ChatsService(prisma, crearWhatsapp() as unknown as WhatsappService);
    const { chats, cuenta } = await service.listar(dueno.id);

    expect(chats.map((chat) => chat.id)).toEqual([nuevo.id, viejo.id]);
    expect(chats[0]).toMatchObject({ telefono: '5491100000002', atencion: 'asistente', teEspera: false });
    expect(chats[0]!.ultimo).toMatchObject({ de: 'asistente', texto: 'Sí, el jueves.' });
    expect(cuenta).toEqual({ todos: 2, asistente: 2, humana: 0 });
    await expect(service.detalle(otro.id, nuevo.id)).rejects.toThrow('No existe ese chat.');
  });

  it('tomar y devolver: devolver arrastra los pedidos derivados y pide contestar lo pendiente con la nota', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const jid = '5491100000004@s.whatsapp.net';
    const chat = await chatCon(dueno.id, jid, [
      { role: 'user', content: { content: 'quiero un mate' }, createdAt: new Date('2026-11-02T10:00:00Z') },
    ]);
    const venta = await prisma.venta.create({
      data: { userId: dueno.id, conversationId: chat.id, estado: 'pendiente_pago', atencion: 'humana' },
    });
    const whatsapp = crearWhatsapp();
    const service = new ChatsService(prisma, whatsapp as unknown as WhatsappService);

    const tomado = await service.cambiarAtencion(dueno.id, chat.id, { humana: true });
    expect(tomado.chat).toMatchObject({ atencion: 'humana', teEspera: true });
    expect(whatsapp.interrumpir).toHaveBeenCalledWith(dueno.id, jid);

    await prisma.message.create({ data: { conversationId: chat.id, role: 'user', content: { content: '¿y?', enAtencionHumana: true } } });
    const devuelto = await service.cambiarAtencion(dueno.id, chat.id, { humana: false, contestar: true, nota: 'ofrecele  el jueves' });

    expect(devuelto).toMatchObject({ contesta: true, chat: { atencion: 'asistente' } });
    expect(whatsapp.contestarPendientes).toHaveBeenCalledWith(dueno.id, jid, 'quiero un mate\n¿y?');
    const guardado = await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } });
    expect(guardado).toMatchObject({ atencion: 'asistente', notaDevolucion: 'ofrecele el jueves' });
    expect(await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).toMatchObject({ atencion: 'asistente' });
    expect(await prisma.eventoVenta.count({ where: { ventaId: venta.id, tipo: 'devolucion' } })).toBe(1);
  });

  it('"Ya lo resolví" devuelve sin pedir respuesta ni guardar la nota', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const chat = await chatCon(dueno.id, '5491100000005@s.whatsapp.net', [
      { role: 'user', content: { content: 'gracias' }, createdAt: new Date() },
    ]);
    await prisma.conversation.update({ where: { id: chat.id }, data: { atencion: 'humana', tomadaAt: new Date() } });
    const whatsapp = crearWhatsapp();
    const service = new ChatsService(prisma, whatsapp as unknown as WhatsappService);

    const devuelto = await service.cambiarAtencion(dueno.id, chat.id, { humana: false, nota: 'no debería quedar' });

    expect(devuelto.contesta).toBe(false);
    expect(whatsapp.contestarPendientes).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } })).notaDevolucion).toBeNull();
  });

  it('un mensaje del panel con la misma llave sale una sola vez, y si no sale no queda guardado', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const jid = '5491100000006@s.whatsapp.net';
    const chat = await chatCon(dueno.id, jid, [{ role: 'user', content: { content: 'hola' }, createdAt: new Date() }]);
    const whatsapp = crearWhatsapp();
    const service = new ChatsService(prisma, whatsapp as unknown as WhatsappService);
    const clave = randomUUID();

    const primero = await service.enviar(dueno.id, chat.id, { texto: ' Hola, soy Caro ', clave });
    const reintento = await service.enviar(dueno.id, chat.id, { texto: 'Hola, soy Caro', clave });

    expect(reintento.id).toBe(primero.id);
    expect(primero).toMatchObject({ de: 'dueno', texto: 'Hola, soy Caro' });
    expect(whatsapp.enviarDesdePanel).toHaveBeenCalledOnce();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } })).toMatchObject({ atencion: 'humana' });

    whatsapp.enviarDesdePanel.mockResolvedValueOnce(false);
    const otra = randomUUID();
    await expect(service.enviar(dueno.id, chat.id, { texto: 'no sale', clave: otra })).rejects.toThrow('No se pudo mandar');
    expect(await prisma.message.count({ where: { conversationId: chat.id, clave: otra } })).toBe(0);
  });
});
