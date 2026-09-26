/**
 * Baja de cuenta contra Postgres real: la cascada del schema tiene que llevarse
 * todo lo del comercio (catálogo, ventas, avisos y la conexión con Mercado
 * Pago), no sólo la agenda. Si alguien agrega una relación sin `onDelete:
 * Cascade`, el `delete` del usuario falla y este test lo marca.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { CheckpointerService } from '../conversation/checkpointer.provider.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { CuentaService } from './cuenta.service.js';

describe.skipIf(!hayBaseDePrueba)('baja de una cuenta de ventas (Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('borra catálogo, ventas, avisos, Mercado Pago y los hilos de sus conversaciones', async () => {
    const dueno = await crearUsuarioDePrueba(prisma);
    await prisma.agent.create({
      data: {
        userId: dueno.id,
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
    const conversacion = await prisma.conversation.create({ data: { userId: dueno.id, remoteJid: '5491122334455@s.whatsapp.net' } });
    const producto = await prisma.producto.create({
      data: {
        userId: dueno.id,
        codigo: 'MATE',
        nombre: 'Mate',
        descripcion: 'De calabaza',
        textoBusqueda: 'mate de calabaza',
        variantes: { create: [{ sku: 'MATE', precioCentavos: 1_000_000, stock: 3 }] },
      },
      include: { variantes: true },
    });
    const venta = await prisma.venta.create({
      data: {
        userId: dueno.id,
        conversationId: conversacion.id,
        nombreCliente: 'Ana',
        estado: 'pendiente_pago',
        medioPago: 'mercadopago',
        totalCentavos: 1_000_000,
        reservaVenceAt: new Date(Date.now() + 30 * 60_000),
        items: {
          create: [
            {
              varianteId: producto.variantes[0].id,
              codigo: 'MATE',
              nombreProducto: 'Mate',
              cantidad: 1,
              precioUnitarioCentavos: 1_000_000,
              subtotalCentavos: 1_000_000,
            },
          ],
        },
      },
    });
    await prisma.notificacion.create({ data: { userId: dueno.id, tipo: 'pedido_manual', titulo: 'Pedido', cuerpo: 'Ana' } });
    await prisma.cuentaMercadoPago.create({
      data: { userId: dueno.id, mpUserId: '123', accessToken: 'cifrado', refreshToken: 'cifrado', expiraAt: new Date() },
    });

    const deleteThread = vi.fn().mockResolvedValue(undefined);
    const cuentas = new CuentaService(
      prisma,
      { get: () => 'x'.repeat(64) } as unknown as ConfigService<Env, true>,
      { unlink: vi.fn().mockResolvedValue(undefined) } as unknown as WhatsappService,
      { cancelar: vi.fn() } as unknown as SubscriptionService,
      { saver: { deleteThread } } as unknown as CheckpointerService,
    );

    await cuentas.eliminar(dueno);

    expect(deleteThread).toHaveBeenCalledWith(conversacion.id);
    const donde = { userId: dueno.id };
    const restos = await Promise.all([
      prisma.user.count({ where: { id: dueno.id } }),
      prisma.agent.count({ where: donde }),
      prisma.conversation.count({ where: donde }),
      prisma.producto.count({ where: donde }),
      prisma.variante.count({ where: { productoId: producto.id } }),
      prisma.venta.count({ where: donde }),
      prisma.itemVenta.count({ where: { ventaId: venta.id } }),
      prisma.notificacion.count({ where: donde }),
      prisma.cuentaMercadoPago.count({ where: donde }),
    ]);
    expect(restos).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
