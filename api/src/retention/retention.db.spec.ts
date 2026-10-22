/** Retención de ventas y avisos contra Postgres real: qué se anonimiza, qué se borra y qué queda. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CheckpointerService } from '../conversation/checkpointer.provider.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import {
  DIAS_RETENCION_AVISOS_LEIDOS,
  DIAS_RETENCION_DATOS_CLIENTE,
  DIAS_RETENCION_MENSAJES,
  DIAS_RETENCION_SUGERENCIAS,
  fechaLimite,
} from './retention.rules.js';
import { RetentionService } from './retention.service.js';

const AHORA = new Date();
/** Un día más viejo que el plazo, y uno más nuevo. */
const pasado = (dias: number) => fechaLimite(dias + 1, AHORA);
const reciente = (dias: number) => fechaLimite(dias - 1, AHORA);

describe.skipIf(!hayBaseDePrueba)('retención de ventas y avisos (Postgres)', () => {
  let prisma: PrismaService;
  let servicio: RetentionService;
  let dueno: User;

  const venta = (createdAt: Date) =>
    prisma.venta.create({
      data: {
        userId: dueno.id,
        nombreCliente: 'Ana',
        telefonoCliente: '5491122334455',
        entrega: 'envio',
        datosCliente: [{ etiqueta: 'Dirección', valor: 'Corrientes 1234' }],
        estado: 'pagada',
        medioPago: 'manual',
        totalCentavos: 1_000_000,
        reservaVenceAt: createdAt,
        createdAt,
        items: {
          create: [
            { codigo: 'MATE', nombreProducto: 'Mate', cantidad: 1, precioUnitarioCentavos: 1_000_000, subtotalCentavos: 1_000_000 },
          ],
        },
      },
    });

  const aviso = (createdAt: Date, leida: boolean) =>
    prisma.notificacion.create({
      data: { userId: dueno.id, tipo: 'venta_pagada', titulo: 'Venta', cuerpo: 'Ana pagó', createdAt, leidaAt: leida ? createdAt : null },
    });

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    const checkpointer = { saver: { deleteThread: vi.fn() } } as unknown as CheckpointerService;
    const whatsapp = { descartar: vi.fn() } as unknown as WhatsappService;
    servicio = new RetentionService(prisma, checkpointer, whatsapp);
    dueno = await crearUsuarioDePrueba(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: dueno.id } });
    await prisma.$disconnect();
  });

  it('a los 12 meses una venta pierde nombre, teléfono y datos del cliente, pero conserva montos e ítems', async () => {
    const vieja = await venta(pasado(DIAS_RETENCION_DATOS_CLIENTE));
    const nueva = await venta(reciente(DIAS_RETENCION_DATOS_CLIENTE));

    await servicio['anonimizarVentas'](AHORA);

    const [trasVieja, trasNueva] = await Promise.all(
      [vieja.id, nueva.id].map((id) => prisma.venta.findUniqueOrThrow({ where: { id }, include: { items: true } })),
    );
    expect(trasVieja).toMatchObject({
      nombreCliente: null,
      telefonoCliente: null,
      datosCliente: null,
      entrega: 'envio',
      totalCentavos: 1_000_000,
      estado: 'pagada',
    });
    expect(trasVieja.items).toHaveLength(1);
    expect(trasNueva).toMatchObject({
      nombreCliente: 'Ana',
      telefonoCliente: '5491122334455',
      datosCliente: [{ etiqueta: 'Dirección', valor: 'Corrientes 1234' }],
    });
  });

  it('a los 12 meses un pedido a medida pierde lo que escribió el cliente y las notas, pero no el producto ni el total', async () => {
    const crear = (createdAt: Date) =>
      prisma.venta.create({
        data: {
          userId: dueno.id,
          tipo: 'a_medida',
          estado: 'cotizado',
          nombreCliente: 'Ana',
          totalCentavos: 500_000,
          detalleDerivacion: 'Quiere que la llamen al 11 5555 5555',
          notaDevolucion: 'Le pasé el precio por teléfono',
          solicitud: {
            productoId: 'p1',
            nombreProducto: 'Placard',
            respuestas: [{ pregunta: 'Dirección de instalación', respuesta: 'Corrientes 1234' }],
            resumen: 'Placard para la casa de Ana',
            variante: { id: 'v1', nombre: 'Blanco 2 puertas', precioCentavos: 400_000, cantidad: 1 },
            cambios: 'Que tenga la manija de Ana',
          },
          createdAt,
          presupuestos: {
            create: [
              { version: 1, origen: 'dueno', estado: 'enviado', renglones: [], totalCentavos: 500_000, nota: 'Para Ana' },
            ],
          },
        },
      });
    const vieja = await crear(pasado(DIAS_RETENCION_DATOS_CLIENTE));
    const nueva = await crear(reciente(DIAS_RETENCION_DATOS_CLIENTE));

    await servicio['anonimizarVentas'](AHORA);

    const [trasVieja, trasNueva] = await Promise.all(
      [vieja.id, nueva.id].map((id) => prisma.venta.findUniqueOrThrow({ where: { id }, include: { presupuestos: true } })),
    );
    expect(trasVieja).toMatchObject({
      nombreCliente: null,
      detalleDerivacion: null,
      notaDevolucion: null,
      totalCentavos: 500_000,
    });
    // Queda qué producto y qué versión era; lo que escribió el cliente (también los cambios), no.
    expect(trasVieja.solicitud).toEqual({
      productoId: 'p1',
      nombreProducto: 'Placard',
      respuestas: [],
      resumen: '',
      variante: { id: 'v1', nombre: 'Blanco 2 puertas', precioCentavos: 400_000, cantidad: 1 },
    });
    expect(trasVieja.presupuestos[0]).toMatchObject({ nota: null, totalCentavos: 500_000 });
    expect(trasNueva).toMatchObject({
      detalleDerivacion: 'Quiere que la llamen al 11 5555 5555',
      solicitud: { resumen: 'Placard para la casa de Ana' },
    });
    expect(trasNueva.presupuestos[0].nota).toBe('Para Ana');
  });

  it('borra los avisos leídos a los 90 días y los no leídos a los 12 meses', async () => {
    const leidoViejo = await aviso(pasado(DIAS_RETENCION_AVISOS_LEIDOS), true);
    const leidoNuevo = await aviso(reciente(DIAS_RETENCION_AVISOS_LEIDOS), true);
    const sinLeerMedio = await aviso(pasado(DIAS_RETENCION_AVISOS_LEIDOS), false);
    const sinLeerViejo = await aviso(pasado(DIAS_RETENCION_DATOS_CLIENTE), false);

    await servicio['purgarAvisos'](AHORA);

    const quedan = await prisma.notificacion.findMany({ where: { userId: dueno.id }, select: { id: true } });
    expect(quedan.map(({ id }) => id).sort()).toEqual([leidoNuevo.id, sinLeerMedio.id].sort());
    expect(quedan.map(({ id }) => id)).not.toContain(leidoViejo.id);
    expect(quedan.map(({ id }) => id)).not.toContain(sinLeerViejo.id);
  });

  it('borra las sugerencias ya enviadas a Linear a los 90 días y nunca las pendientes', async () => {
    const sugerencia = (enviadaAt: Date | null, createdAt: Date) =>
      prisma.sugerenciaMejora.create({
        data: { userId: dueno.id, tipo: 'idea', texto: 'Recordatorios el día antes', enviadaAt, createdAt },
      });
    const enviadaVieja = await sugerencia(pasado(DIAS_RETENCION_SUGERENCIAS), pasado(DIAS_RETENCION_SUGERENCIAS));
    const enviadaNueva = await sugerencia(reciente(DIAS_RETENCION_SUGERENCIAS), pasado(DIAS_RETENCION_SUGERENCIAS));
    const pendienteVieja = await sugerencia(null, pasado(DIAS_RETENCION_DATOS_CLIENTE));

    await servicio['purgarSugerencias'](AHORA);

    const quedan = await prisma.sugerenciaMejora.findMany({ where: { userId: dueno.id }, select: { id: true } });
    expect(quedan.map(({ id }) => id).sort()).toEqual([enviadaNueva.id, pendienteVieja.id].sort());
    expect(quedan.map(({ id }) => id)).not.toContain(enviadaVieja.id);
  });
  it('a los 12 meses el registro de performance se desliga del chat y queda como conteo', async () => {
    const conversation = await prisma.conversation.create({
      data: { userId: dueno.id, remoteJid: '5491100000001@s.whatsapp.net' },
    });
    const producto = await prisma.producto.create({ data: { userId: dueno.id, codigo: 'PERF', nombre: 'Mate' } });
    const viejo = pasado(DIAS_RETENCION_DATOS_CLIENTE);
    await prisma.etapaChat.create({
      data: { userId: dueno.id, conversationId: conversation.id, etapa: 'pagado', ultimaActividadAt: viejo },
    });
    await prisma.interesProducto.createMany({
      data: [
        { userId: dueno.id, conversationId: conversation.id, productoId: producto.id, tipo: 'vio', createdAt: viejo },
        {
          userId: dueno.id,
          conversationId: conversation.id,
          productoId: producto.id,
          tipo: 'pidio',
          createdAt: reciente(DIAS_RETENCION_DATOS_CLIENTE),
        },
      ],
    });

    await servicio['desligarPerformance'](AHORA);

    expect(await prisma.etapaChat.findMany({ where: { userId: dueno.id } })).toEqual([
      expect.objectContaining({ conversationId: null, etapa: 'pagado' }),
    ]);
    const intereses = await prisma.interesProducto.findMany({ where: { userId: dueno.id }, orderBy: { tipo: 'asc' } });
    expect(intereses.map((interes) => [interes.tipo, interes.conversationId])).toEqual([
      ['pidio', conversation.id],
      ['vio', null],
    ]);
  });
  it('el texto de las preguntas se borra a los 90 días o cuando el chat se desliga; el tema queda', async () => {
    const conversation = await prisma.conversation.create({
      data: { userId: dueno.id, remoteJid: '5491100000002@s.whatsapp.net' },
    });
    const ligada = await prisma.etapaChat.create({ data: { userId: dueno.id, conversationId: conversation.id } });
    const desligada = await prisma.etapaChat.create({ data: { userId: dueno.id, conversationId: null } });
    const pregunta = (etapaChatId: string, createdAt: Date) =>
      prisma.preguntaChat.create({
        data: { userId: dueno.id, etapaChatId, texto: '¿Hacen envíos?', tema: 'envio', resuelta: true, etapa: 'pedido', createdAt },
      });
    const vieja = await pregunta(ligada.id, pasado(DIAS_RETENCION_MENSAJES));
    const nueva = await pregunta(ligada.id, reciente(DIAS_RETENCION_MENSAJES));
    const deDesligado = await pregunta(desligada.id, reciente(DIAS_RETENCION_MENSAJES));

    await servicio['purgarPreguntas'](AHORA);

    const trasPurga = await prisma.preguntaChat.findMany({
      where: { id: { in: [vieja.id, nueva.id, deDesligado.id] } },
      select: { id: true, texto: true, tema: true },
    });
    const por = new Map(trasPurga.map((fila) => [fila.id, fila]));
    expect(por.get(vieja.id)).toMatchObject({ texto: null, tema: 'envio' });
    expect(por.get(nueva.id)).toMatchObject({ texto: '¿Hacen envíos?' });
    expect(por.get(deDesligado.id)).toMatchObject({ texto: null, tema: 'envio' });
  });
});
