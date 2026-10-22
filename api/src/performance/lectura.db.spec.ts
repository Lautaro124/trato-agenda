/** Lectura del módulo de performance contra Postgres real: cohorte del período, tasas, productos y aislamiento por cuenta. */
import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { LecturaPerformanceService } from './lectura.service.js';
import type { Etapa } from './etapas.rules.js';

/** Todo pasa en octubre de 2026; "ahora" es el 31 a la tarde. */
const AHORA = new Date('2026-10-31T18:00:00-03:00');
const dia = (d: number, hora = '10:00') => new Date(`2026-10-${String(d).padStart(2, '0')}T${hora}:00-03:00`);
const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' };

describe.skipIf(!hayBaseDePrueba)('lectura de performance (Postgres)', () => {
  let prisma: PrismaService;
  let lectura: LecturaPerformanceService;
  let dueno: User;
  let otro: User;
  let numero = 0;

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

  /** Un chat registrado con su etapa; devuelve el id de la conversación. */
  async function chat(userId: string, etapa: Etapa, creado: Date, ultimaActividadAt = creado, derivado = false) {
    const conversacion = await prisma.conversation.create({
      data: { userId, remoteJid: `54911${String(++numero).padStart(8, '0')}@s.whatsapp.net` },
    });
    await prisma.etapaChat.create({
      data: { userId, conversationId: conversacion.id, etapa, createdAt: creado, ultimaActividadAt, derivado },
    });
    return conversacion.id;
  }

  const interes = (userId: string, conversationId: string, productoId: string, tipo: 'vio' | 'pidio') =>
    prisma.interesProducto.create({ data: { userId, conversationId, productoId, tipo } });

  async function venta(
    userId: string,
    conversationId: string,
    datos: { estado: string; varianteId?: string; cantidad?: number; subtotal?: number; moneda?: string; dePrueba?: boolean },
  ) {
    const cantidad = datos.cantidad ?? 1;
    const subtotal = datos.subtotal ?? 1_000_000;
    return prisma.venta.create({
      data: {
        userId,
        conversationId,
        estado: datos.estado,
        moneda: datos.moneda ?? 'ARS',
        dePrueba: datos.dePrueba ?? false,
        totalCentavos: subtotal,
        items: {
          create: [
            {
              varianteId: datos.varianteId,
              codigo: 'X',
              nombreProducto: 'X',
              cantidad,
              precioUnitarioCentavos: subtotal / cantidad,
              subtotalCentavos: subtotal,
            },
          ],
        },
      },
    });
  }

  let mate: { id: string; varianteId: string };
  let placard: string;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    lectura = new LecturaPerformanceService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
    await cuentaDeVentas(dueno.id);
    await cuentaDeVentas(otro.id);

    const productoMate = await prisma.producto.create({
      data: { userId: dueno.id, codigo: 'MATE', nombre: 'Mate', variantes: { create: [{ sku: 'MATE', precioCentavos: 1_000_000 }] } },
      include: { variantes: true },
    });
    mate = { id: productoMate.id, varianteId: productoMate.variantes[0].id };
    placard = (
      await prisma.producto.create({ data: { userId: dueno.id, codigo: 'PLACARD', nombre: 'Placard', solicitud: { preguntas: [] } } })
    ).id;
    const ajeno = await prisma.producto.create({ data: { userId: otro.id, codigo: 'AJENO', nombre: 'Ajeno' } });

    // Septiembre: un chat que vio el mate y no compró (período anterior).
    const septiembre = await chat(dueno.id, 'vio_productos', new Date('2026-09-20T10:00:00-03:00'));
    await interes(dueno.id, septiembre, mate.id, 'vio');

    // Octubre:
    // 1. vio y pagó el mate (2 unidades).
    const pago = await chat(dueno.id, 'pagado', dia(2));
    await interes(dueno.id, pago, mate.id, 'vio');
    await interes(dueno.id, pago, mate.id, 'pidio');
    await venta(dueno.id, pago, { estado: 'pagada', varianteId: mate.varianteId, cantidad: 2, subtotal: 2_000_000 });
    // 2. pidió el mate y no pagó; el chat está quieto hace 3 días: estancado.
    const pendiente = await chat(dueno.id, 'pedido', dia(5), dia(28, '12:00'));
    await interes(dueno.id, pendiente, mate.id, 'vio');
    await interes(dueno.id, pendiente, mate.id, 'pidio');
    await venta(dueno.id, pendiente, { estado: 'pendiente_pago', varianteId: mate.varianteId });
    // 3. vio el mate y se fue hace semanas, derivado: abandonado.
    const abandonado = await chat(dueno.id, 'vio_productos', dia(6), dia(7), true);
    await interes(dueno.id, abandonado, mate.id, 'vio');
    // 4. pidió el placard a medida y lo pagó.
    const aMedida = await chat(dueno.id, 'pagado', dia(10));
    await interes(dueno.id, aMedida, placard, 'pidio');
    await prisma.venta.create({
      data: {
        userId: dueno.id,
        conversationId: aMedida,
        tipo: 'a_medida',
        estado: 'pagada',
        totalCentavos: 5_000_000,
        solicitud: { productoId: placard, nombreProducto: 'Placard', respuestas: [], resumen: '' },
      },
    });
    // 5. sólo consultó, hace un rato: activo. Tiene una venta de prueba y una en dólares, que no cuentan.
    const consulta = await chat(dueno.id, 'consulta', dia(31, '09:00'), dia(31, '17:00'));
    await venta(dueno.id, consulta, { estado: 'pagada', varianteId: mate.varianteId, dePrueba: true });
    await venta(dueno.id, consulta, { estado: 'pagada', varianteId: mate.varianteId, moneda: 'USD' });

    // Otra cuenta, mismo período: no se mezcla.
    const deOtro = await chat(otro.id, 'pagado', dia(3));
    await interes(otro.id, deOtro, ajeno.id, 'vio');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('cuenta la conversión de los chats nuevos del período, sin pruebas ni otra moneda', async () => {
    const { conversion, datos, registroDesde } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(datos).toBe('completos');
    expect(registroDesde).toBe('2026-09-20');
    expect(conversion).toMatchObject({
      chats: 5,
      conPedido: 3,
      conPago: 2,
      pedidos: 3,
      pagados: 2,
      chatAPedido: { valor: 0.6 },
      pedidoAPago: { valor: 0.6667 },
      chatAPago: { valor: 0.4 },
    });
    // Septiembre: un chat que no pidió nada. 0 %, que no es "sin datos".
    expect(conversion.anterior).toMatchObject({ chats: 1, conPedido: 0, chatAPedido: { valor: 0 }, pedidoAPago: { valor: null } });
  });

  it('reparte los chats por etapa y estado', async () => {
    const { etapas } = await lectura.leer(dueno.id, OCTUBRE, AHORA);
    const de = (etapa: Etapa) => etapas.find((fila) => fila.etapa === etapa);

    expect(etapas.map((fila) => fila.etapa)).toEqual([
      'consulta',
      'vio_productos',
      'eligiendo',
      'lista',
      'pedido',
      'cotizado',
      'pagado',
    ]);
    expect(de('consulta')).toMatchObject({ total: 1, activos: 1 });
    expect(de('vio_productos')).toMatchObject({ total: 1, abandonados: 1, derivados: 1 });
    expect(de('pedido')).toMatchObject({ total: 1, estancados: 1 });
    expect(de('pagado')).toMatchObject({ total: 2, activos: 0, estancados: 0, abandonados: 0 });
    expect(de('lista')).toMatchObject({ total: 0 });
  });

  it('por producto: vieron, pidieron, pagaron y dónde se cortan', async () => {
    const { productos } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(productos.map((producto) => producto.codigo)).toEqual(['MATE', 'PLACARD']);
    expect(productos[0]).toMatchObject({
      aMedida: false,
      vieron: 3,
      pidieron: 2,
      pagaron: 1,
      unidades: 2,
      cobradoCentavos: 2_000_000,
      vioAPidio: { valor: 0.6667 },
      pidioAPago: { valor: 0.5 },
      // Empate entre vio_productos y pedido: la más temprana.
      cortanEn: 'vio_productos',
    });
    expect(productos[1]).toMatchObject({
      aMedida: true,
      vieron: 0,
      pidieron: 1,
      pagaron: 1,
      cobradoCentavos: 5_000_000,
      vioAPidio: { valor: null },
      cortanEn: null,
    });
  });

  it('un período anterior al primer chat no tiene datos', async () => {
    const lectura2026 = await lectura.leer(dueno.id, { desde: '2026-08-01', hasta: '2026-08-31' }, AHORA);
    expect(lectura2026.datos).toBe('sin_datos');
    expect(lectura2026.conversion.chatAPedido).toEqual({ valor: null });
    expect(lectura2026.conversion.anterior).toBeNull();
    expect(lectura2026.productos).toEqual([]);
  });

  it('la otra cuenta sólo ve lo suyo', async () => {
    const suya = await lectura.leer(otro.id, OCTUBRE, AHORA);
    expect(suya.conversion.chats).toBe(1);
    expect(suya.productos.map((producto) => producto.codigo)).toEqual(['AJENO']);
  });

  it('una cuenta de agenda no tiene performance', async () => {
    const deAgenda = await crearUsuarioDePrueba(prisma);
    try {
      await expect(lectura.leer(deAgenda.id, OCTUBRE, AHORA)).rejects.toBeInstanceOf(ConflictException);
    } finally {
      await prisma.user.delete({ where: { id: deAgenda.id } });
    }
  });
});
