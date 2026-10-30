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
  async function chat(
    userId: string,
    etapa: Etapa,
    creado: Date,
    ultimaActividadAt = creado,
    derivado = false,
    zona: { provincia: string; origenZona: 'dato' | 'inferida' } | null = null,
  ) {
    const conversacion = await prisma.conversation.create({
      data: { userId, remoteJid: `54911${String(++numero).padStart(8, '0')}@s.whatsapp.net` },
    });
    await prisma.etapaChat.create({
      data: { userId, conversationId: conversacion.id, etapa, createdAt: creado, ultimaActividadAt, derivado, ...zona },
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
    const pago = await chat(dueno.id, 'pagado', dia(2), dia(2), false, { provincia: 'cordoba', origenZona: 'dato' });
    await interes(dueno.id, pago, mate.id, 'vio');
    await interes(dueno.id, pago, mate.id, 'pidio');
    await venta(dueno.id, pago, { estado: 'pagada', varianteId: mate.varianteId, cantidad: 2, subtotal: 2_000_000 });
    // 2. pidió el mate y no pagó; el chat está quieto hace 3 días: estancado.
    const pendiente = await chat(dueno.id, 'pedido', dia(5), dia(28, '12:00'), false, { provincia: 'cordoba', origenZona: 'inferida' });
    await interes(dueno.id, pendiente, mate.id, 'vio');
    await interes(dueno.id, pendiente, mate.id, 'pidio');
    await venta(dueno.id, pendiente, { estado: 'pendiente_pago', varianteId: mate.varianteId });
    // 3. vio el mate y se fue hace semanas, derivado: abandonado.
    const abandonado = await chat(dueno.id, 'vio_productos', dia(6), dia(7), true);
    await interes(dueno.id, abandonado, mate.id, 'vio');
    // 4. pidió el placard a medida y lo pagó.
    const aMedida = await chat(dueno.id, 'pagado', dia(10), dia(10), false, { provincia: 'mendoza', origenZona: 'dato' });
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

    // Preguntas, ya clasificadas, de tres de esos chats.
    const preguntas: Array<[string, string, string, boolean, string | null, string | null]> = [
      // [conversación, etapa del chat, tema, resuelta, producto, texto]
      [pendiente, 'pedido', 'envio', false, mate.id, '¿Hacen envíos a Córdoba?'],
      [abandonado, 'vio_productos', 'precio', true, mate.id, '¿Cuánto sale el mate?'],
      [abandonado, 'vio_productos', 'envio', false, mate.id, null],
      [pago, 'pagado', 'stock', true, mate.id, '¿Tiene virola?'],
    ];
    for (const [conversationId, etapaDelChat, tema, resuelta, productoId, texto] of preguntas) {
      const { id: etapaChatId } = await prisma.etapaChat.update({ where: { conversationId }, data: { clasificadaAt: dia(31) } });
      await prisma.preguntaChat.create({ data: { userId: dueno.id, etapaChatId, etapa: etapaDelChat, tema, resuelta, productoId, texto } });
    }

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
      cobradoCentavos: 7_000_000,
    });
  });

  it('compara con el período anterior de igual largo, que arranca antes del registro', async () => {
    const { anterior } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(anterior.rango).toEqual({ primerDia: '2026-08-31', ultimoDia: '2026-09-30' });
    expect(anterior.datos).toBe('parciales');
    // Septiembre: un chat que no pidió nada. 0 %, que no es "sin datos".
    expect(anterior.conversion).toMatchObject({ chats: 1, conPedido: 0, chatAPedido: { valor: 0 }, pedidoAPago: { valor: null } });
    expect(anterior.porDia).toHaveLength(31);
    expect(anterior.porDia?.find((fila) => fila.chats > 0)?.dia).toBe('2026-09-20');
  });

  it('cuenta día por día según el día en que escribió cada chat, en la hora del negocio', async () => {
    const { porDia, conversion } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(porDia).toHaveLength(31);
    expect(porDia.filter((fila) => fila.chats > 0).map((fila) => fila.dia)).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-06',
      '2026-10-10',
      '2026-10-31',
    ]);
    expect(porDia[1]).toEqual({ dia: '2026-10-02', chats: 1, conPedido: 1, pedidos: 1, pagados: 1, conPago: 1, cobradoCentavos: 2_000_000 });
    expect(porDia.reduce((suma, fila) => suma + fila.chats, 0)).toBe(conversion.chats);
  });

  it('el día de un chat es el del negocio: las 23:30 del 30/9 ya son 1/10 en UTC', async () => {
    const deNoche = await prisma.conversation.create({ data: { userId: otro.id, remoteJid: '5491199999999@s.whatsapp.net' } });
    await prisma.etapaChat.create({
      data: { userId: otro.id, conversationId: deNoche.id, etapa: 'consulta', createdAt: new Date('2026-09-30T23:30:00-03:00') },
    });
    try {
      const delOtro = await lectura.leer(otro.id, { desde: '2026-09-30', hasta: '2026-10-01' }, AHORA);
      expect(delOtro.porDia.map((fila) => [fila.dia, fila.chats])).toEqual([
        ['2026-09-30', 1],
        ['2026-10-01', 0],
      ]);
    } finally {
      await prisma.etapaChat.delete({ where: { conversationId: deNoche.id } });
      await prisma.conversation.delete({ where: { id: deNoche.id } });
    }
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

  it('reparte los chats por zona, con las inferidas aparte y los sin zona al final', async () => {
    const { zonas } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(zonas).toEqual([
      expect.objectContaining({ zona: 'cordoba', nombre: 'Córdoba', chats: 2, inferidas: 1, conPedido: 2, conPago: 1, chatAPago: { valor: 0.5 } }),
      expect.objectContaining({ zona: 'mendoza', chats: 1, inferidas: 0, conPago: 1 }),
      expect.objectContaining({ zona: 'sin_zona', nombre: 'Sin zona', chats: 2, conPedido: 0 }),
    ]);
  });

  it('filtrar por zona acota la conversión, las etapas y los productos', async () => {
    const cordoba = await lectura.leer(dueno.id, { ...OCTUBRE, zona: 'cordoba' }, AHORA);

    expect(cordoba.zona).toBe('cordoba');
    expect(cordoba.conversion).toMatchObject({ chats: 2, conPedido: 2, conPago: 1, pedidos: 2, pagados: 1 });
    expect(cordoba.etapas.reduce((total, etapa) => total + etapa.total, 0)).toBe(2);
    expect(cordoba.productos).toEqual([expect.objectContaining({ codigo: 'MATE', vieron: 2, pidieron: 2, pagaron: 1 })]);
    // El desglose por zona no se filtra: es para comparar.
    expect(cordoba.zonas).toHaveLength(3);

    const sinZona = await lectura.leer(dueno.id, { ...OCTUBRE, zona: 'sin_zona' }, AHORA);
    expect(sinZona.conversion.chats).toBe(2);
    expect(sinZona.productos.map((producto) => [producto.codigo, producto.vieron])).toEqual([['MATE', 1]]);
  });

  it('las preguntas: por tema con ejemplos, por producto y dónde se quedan', async () => {
    const { preguntas } = await lectura.leer(dueno.id, OCTUBRE, AHORA);

    expect(preguntas.analizados).toBe(3);
    expect(preguntas.chats).toBe(5);
    expect(preguntas.porTema).toEqual([
      // El texto vencido (null) no aparece entre los ejemplos.
      { tema: 'envio', nombre: 'Envío', total: 2, sinResolver: 2, ejemplos: ['¿Hacen envíos a Córdoba?'] },
      { tema: 'precio', nombre: 'Precio', total: 1, sinResolver: 0, ejemplos: ['¿Cuánto sale el mate?'] },
      { tema: 'stock', nombre: 'Stock y variantes', total: 1, sinResolver: 0, ejemplos: ['¿Tiene virola?'] },
    ]);
    expect(preguntas.porProducto).toEqual([{ productoId: mate.id, nombre: 'Mate', total: 4, sinResolver: 2, temaPrincipal: 'envio' }]);
    // Los chats que pagaron no cuentan para "dónde se quedan".
    expect(preguntas.dondeSeQuedan).toEqual([
      { etapa: 'pedido', tema: 'envio', total: 1 },
      { etapa: 'vio_productos', tema: 'envio', total: 1 },
      { etapa: 'vio_productos', tema: 'precio', total: 1 },
    ]);

    const cordoba = await lectura.leer(dueno.id, { ...OCTUBRE, zona: 'cordoba' }, AHORA);
    expect(cordoba.preguntas.analizados).toBe(2);
    expect(cordoba.preguntas.porTema.map((fila) => [fila.tema, fila.total])).toEqual([
      ['envio', 1],
      ['stock', 1],
    ]);
    // La otra cuenta no ve ninguna.
    expect((await lectura.leer(otro.id, OCTUBRE, AHORA)).preguntas.porTema).toEqual([]);
  });

  it('un período anterior al primer chat no tiene datos', async () => {
    const lectura2026 = await lectura.leer(dueno.id, { desde: '2026-08-01', hasta: '2026-08-31' }, AHORA);
    expect(lectura2026.datos).toBe('sin_datos');
    expect(lectura2026.conversion.chatAPedido).toEqual({ valor: null });
    expect(lectura2026.anterior).toMatchObject({ datos: 'sin_datos', conversion: null, porDia: null });
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
