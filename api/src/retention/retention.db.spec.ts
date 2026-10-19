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
});
