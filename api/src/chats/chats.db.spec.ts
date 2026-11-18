/**
 * Chats contra Postgres real (LAU-81): el trigger que mantiene
 * `ultimoMensajeAt`, las consultas crudas de la lista, el aislamiento por
 * dueño, la devolución que arrastra los pedidos derivados y la idempotencia
 * de los mensajes del panel; los indicadores de Inicio y el estado del trato
 * que marca el dueño (con Ventas simulado: sus reglas tienen su propio spec).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VentasService } from '../comercio/ventas.service.js';
import type { RegistroPerformanceService } from '../performance/registro.service.js';
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

const registro = { avanzarPorVenta: vi.fn().mockResolvedValue(undefined) } as unknown as RegistroPerformanceService;

describe.skipIf(!hayBaseDePrueba)('ChatsService (Postgres)', () => {
  let prisma: PrismaService;

  /** Ventas simulado: crea y paga pedidos de verdad en la base, sin Mercado Pago ni WhatsApp. */
  function crearVentas() {
    return {
      crearPedido: vi.fn(async (input: { userId: string; conversationId: string }) =>
        prisma.venta.create({ data: { userId: input.userId, conversationId: input.conversationId, medioPago: 'manual' } }),
      ),
      marcarPagadaPorElDueno: vi.fn(async (_userId: string, ventaId: string) =>
        prisma.venta.update({ where: { id: ventaId }, data: { estado: 'pagada', pagadaAt: new Date() } }),
      ),
      cancelar: vi.fn(async (_userId: string, ventaId: string) =>
        prisma.venta.update({ where: { id: ventaId }, data: { estado: 'cancelada', canceladaAt: new Date() } }),
      ),
      cotizarFormasDePago: vi.fn(),
    };
  }

  function servicio(whatsapp = crearWhatsapp(), ventas = crearVentas()) {
    return new ChatsService(
      prisma,
      whatsapp as unknown as WhatsappService,
      ventas as unknown as VentasService,
      registro,
    );
  }

  const cuentaDeVentas = (userId: string) =>
    prisma.agent.create({
      data: {
        userId,
        tipoAsistente: 'ventas',
        nombreBot: 'Sol',
        descripcion: 'Mates',
        tipoUso: 'otro',
        systemPrompt: 'Vendé mates.',
        allowedActions: ['buscar_productos'],
        horaDesde: '00:00',
        horaHasta: '23:59',
      },
    });

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

    const service = servicio();
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
    const service = servicio(whatsapp);

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
    const service = servicio(whatsapp);

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
    const service = servicio(whatsapp);
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

  it('indicadores: chats nuevos, intervenciones y conversión a venta de los últimos 7 días', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    await cuentaDeVentas(dueno.id);
    const ahora = new Date();
    const hace = (dias: number) => new Date(ahora.getTime() - dias * 24 * 60 * 60_000);
    const pagado = await chatCon(dueno.id, '5491100000011@s.whatsapp.net', [{ role: 'user', content: { content: 'a' }, createdAt: hace(1) }]);
    await prisma.venta.create({ data: { userId: dueno.id, conversationId: pagado.id, estado: 'pagada' } });
    const tomado = await chatCon(dueno.id, '5491100000012@s.whatsapp.net', [{ role: 'user', content: { content: 'b' }, createdAt: hace(1) }]);
    await prisma.conversation.update({ where: { id: tomado.id }, data: { atencion: 'humana', tomadaAt: hace(1) } });
    // Una venta del banco de pruebas no convierte, y un chat viejo no es nuevo.
    const prueba = await chatCon(dueno.id, '5491100000013@s.whatsapp.net', [{ role: 'user', content: { content: 'c' }, createdAt: hace(1) }]);
    await prisma.venta.create({ data: { userId: dueno.id, conversationId: prueba.id, estado: 'pagada', dePrueba: true } });
    const viejo = await chatCon(dueno.id, '5491100000014@s.whatsapp.net', [{ role: 'user', content: { content: 'd' }, createdAt: hace(1) }]);
    await prisma.conversation.update({ where: { id: viejo.id }, data: { createdAt: hace(20) } });

    expect(await servicio().indicadores(dueno.id, ahora)).toEqual({
      dias: 7,
      nuevos: 3,
      intervenciones: 1,
      convertidos: 1,
      conversionA: 'venta',
    });
  });

  it('trato: hecho arma el pedido del dueño, pagado lo cobra y cancelado lo cancela', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    await cuentaDeVentas(dueno.id);
    const chat = await chatCon(dueno.id, '5491100000015@s.whatsapp.net', [{ role: 'user', content: { content: 'quiero un mate' }, createdAt: new Date() }]);
    const ventas = crearVentas();
    const service = servicio(crearWhatsapp(), ventas);

    await expect(service.cambiarTrato(dueno.id, chat.id, { estado: 'hecho' })).rejects.toThrow('Elegí al menos un producto.');
    const hecho = await service.cambiarTrato(dueno.id, chat.id, { estado: 'hecho', items: [{ productoId: 'p1', cantidad: 2 }] });
    expect(hecho.trato).toBe('hecho');
    expect(ventas.crearPedido).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: chat.id, medioPago: 'manual', delDueno: true, items: [{ productoId: 'p1', cantidad: 2 }] }),
    );
    // Con el pedido abierto, "hecho" otra vez no arma otro.
    await service.cambiarTrato(dueno.id, chat.id, { estado: 'hecho', items: [{ productoId: 'p1', cantidad: 1 }] });
    expect(ventas.crearPedido).toHaveBeenCalledOnce();

    const cancelado = await service.cambiarTrato(dueno.id, chat.id, { estado: 'cancelado' });
    expect(cancelado.trato).toBe('cancelado');
    expect(ventas.cancelar).toHaveBeenCalledOnce();

    // Cancelado sin pedido abierto: "pagado" crea uno nuevo y lo cobra.
    const pagado = await service.cambiarTrato(dueno.id, chat.id, { estado: 'pagado', items: [{ productoId: 'p1', cantidad: 1 }] });
    expect(pagado.trato).toBe('pagado');
    expect(ventas.marcarPagadaPorElDueno).toHaveBeenCalledOnce();
    await expect(service.cambiarTrato(dueno.id, chat.id, { estado: 'cancelado' })).rejects.toThrow('ya tiene el pedido pagado');
  });

  it('trato: sólo cuentas de ventas y sólo chats propios', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    const otro = await crearUsuarioDePrueba(prisma);
    await cuentaDeVentas(otro.id);
    const chat = await chatCon(dueno.id, '5491100000016@s.whatsapp.net', [{ role: 'user', content: { content: 'hola' }, createdAt: new Date() }]);

    await expect(servicio().cambiarTrato(dueno.id, chat.id, { estado: 'cancelado' })).rejects.toThrow('cuentas que venden');
    await expect(servicio().cambiarTrato(otro.id, chat.id, { estado: 'cancelado' })).rejects.toThrow('No existe ese chat.');
    await expect(servicio().ficha(otro.id, chat.id)).rejects.toThrow('No existe ese chat.');
  });
});
