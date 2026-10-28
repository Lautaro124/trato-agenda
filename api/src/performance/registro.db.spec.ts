/** Registro del módulo de performance contra Postgres real: etapas que no retroceden, interés sin repetidos y aislamiento por cuenta. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Conversation, Producto, User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { RegistroPerformanceService } from './registro.service.js';

describe.skipIf(!hayBaseDePrueba)('registro de performance (Postgres)', () => {
  let prisma: PrismaService;
  let registro: RegistroPerformanceService;
  let dueno: User;
  let otro: User;
  let chat: Conversation;
  let mate: Producto;
  let termo: Producto;
  let ajeno: Producto;
  let numero = 0;

  const conversacion = (userId: string, remoteJid = `54911${String(++numero).padStart(8, '0')}@s.whatsapp.net`) =>
    prisma.conversation.create({ data: { userId, remoteJid } });
  const producto = (userId: string, codigo: string) => prisma.producto.create({ data: { userId, codigo, nombre: codigo } });
  const etapa = () => prisma.etapaChat.findUnique({ where: { conversationId: chat.id } });

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    registro = new RegistroPerformanceService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
    mate = await producto(dueno.id, 'MATE');
    termo = await producto(dueno.id, 'TERMO');
    ajeno = await producto(otro.id, 'AJENO');
  });

  beforeEach(async () => {
    chat = await conversacion(dueno.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('el primer mensaje deja el chat en consulta, y la etapa de Jev lo avanza', async () => {
    await registro.tocarChat(dueno.id, chat.id);
    expect(await etapa()).toMatchObject({ userId: dueno.id, etapa: 'consulta', etapaJev: null });

    await registro.tocarChat(dueno.id, chat.id, { etapaJev: 'lista' });
    expect(await etapa()).toMatchObject({ etapa: 'lista', etapaJev: 'lista' });
  });

  it('la etapa nunca retrocede, aunque Jev diga que volvió a elegir', async () => {
    await registro.registrarInteres(dueno.id, chat.id, [mate.id], 'pidio');
    await registro.tocarChat(dueno.id, chat.id, { etapaJev: 'eligiendo' });
    await registro.registrarInteres(dueno.id, chat.id, [termo.id], 'vio');

    expect(await etapa()).toMatchObject({ etapa: 'pedido', etapaJev: 'eligiendo' });
  });

  it('un producto visto dos veces cuenta una sola, y los de otra cuenta se ignoran', async () => {
    await registro.registrarInteres(dueno.id, chat.id, [mate.id, mate.id, ajeno.id], 'vio');
    await registro.registrarInteres(dueno.id, chat.id, [mate.id], 'vio');

    const intereses = await prisma.interesProducto.findMany({ where: { conversationId: chat.id } });
    expect(intereses.map((interes) => [interes.productoId, interes.tipo])).toEqual([[mate.id, 'vio']]);
    expect(await etapa()).toMatchObject({ etapa: 'vio_productos' });
  });

  it('un pedido por variantes se anota en su producto', async () => {
    const variante = await prisma.variante.create({
      data: { productoId: termo.id, sku: 'TERMO-1L', nombre: '1 litro', precioCentavos: 100_000 },
    });
    await registro.registrarPedidoDeVariantes(dueno.id, chat.id, [variante.id, 'no-existe']);

    const intereses = await prisma.interesProducto.findMany({ where: { conversationId: chat.id } });
    expect(intereses.map((interes) => [interes.productoId, interes.tipo])).toEqual([[termo.id, 'pidio']]);
  });

  it('una venta pagada lleva el chat a pagado; una de prueba o sin chat no hace nada', async () => {
    await registro.avanzarPorVenta({ userId: dueno.id, conversationId: chat.id, dePrueba: true }, 'pagado');
    expect(await etapa()).toBeNull();

    await registro.avanzarPorVenta({ userId: dueno.id, conversationId: null, dePrueba: false }, 'pagado');
    await registro.avanzarPorVenta({ userId: dueno.id, conversationId: chat.id, dePrueba: false }, 'cotizado');
    await registro.avanzarPorVenta({ userId: dueno.id, conversationId: chat.id, dePrueba: false }, 'pagado');
    await registro.avanzarPorVenta({ userId: dueno.id, conversationId: chat.id, dePrueba: false }, 'cotizado');
    expect(await etapa()).toMatchObject({ etapa: 'pagado' });
  });

  it('infiere la zona de la característica y la que da el cliente le gana', async () => {
    const cordobes = await conversacion(dueno.id, '5493511234567@s.whatsapp.net');
    const zona = () => prisma.etapaChat.findUnique({ where: { conversationId: cordobes.id }, select: { provincia: true, origenZona: true } });

    await registro.tocarChat(dueno.id, cordobes.id);
    expect(await zona()).toEqual({ provincia: 'cordoba', origenZona: 'inferida' });

    await registro.registrarZonaDeDatos(dueno.id, cordobes.id, [{ etiqueta: 'Provincia', valor: 'Mendoza' }]);
    expect(await zona()).toEqual({ provincia: 'mendoza', origenZona: 'dato' });

    // La inferida no pisa un dato, y datos que no dicen provincia no borran nada.
    await registro.tocarChat(dueno.id, cordobes.id);
    await registro.registrarZonaDeDatos(dueno.id, cordobes.id, [{ etiqueta: 'Dirección', valor: 'Belgrano 100' }]);
    expect(await zona()).toEqual({ provincia: 'mendoza', origenZona: 'dato' });
  });

  it('un número de otro país queda sin zona', async () => {
    const uruguayo = await conversacion(dueno.id, '59899123456@s.whatsapp.net');
    await registro.tocarChat(dueno.id, uruguayo.id);
    expect(await prisma.etapaChat.findUnique({ where: { conversationId: uruguayo.id } })).toMatchObject({ provincia: null, origenZona: null });
  });

  it('marca el chat derivado', async () => {
    await registro.marcarDerivado(dueno.id, chat.id);
    expect(await etapa()).toMatchObject({ derivado: true, etapa: 'consulta' });
  });

  it('no registra la conversación de otra cuenta ni el banco de pruebas', async () => {
    const deOtro = await conversacion(otro.id);
    const deBanco = await conversacion(dueno.id, `web-test:${dueno.id}`);

    await registro.tocarChat(dueno.id, deOtro.id);
    await registro.registrarInteres(dueno.id, deOtro.id, [mate.id], 'vio');
    await registro.tocarChat(dueno.id, deBanco.id);
    await registro.registrarInteres(dueno.id, deBanco.id, [mate.id], 'vio');

    const ids = [deOtro.id, deBanco.id];
    expect(await prisma.etapaChat.count({ where: { conversationId: { in: ids } } })).toBe(0);
    expect(await prisma.interesProducto.count({ where: { conversationId: { in: ids } } })).toBe(0);
  });

  it('un error no se propaga', async () => {
    const roto = new RegistroPerformanceService({
      conversation: { findFirst: () => Promise.reject(new Error('base caída')) },
    } as unknown as PrismaService);
    await expect(roto.tocarChat(dueno.id, chat.id)).resolves.toBeUndefined();
  });

  it('borrar la conversación deja la etapa y el interés como conteo de la cuenta', async () => {
    await registro.registrarInteres(dueno.id, chat.id, [mate.id], 'vio');
    await prisma.conversation.delete({ where: { id: chat.id } });

    const huerfanas = await prisma.etapaChat.count({ where: { userId: dueno.id, conversationId: null } });
    expect(huerfanas).toBeGreaterThan(0);
    expect(await prisma.interesProducto.count({ where: { userId: dueno.id, conversationId: null } })).toBeGreaterThan(0);
  });
});
