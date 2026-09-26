/** Retención de ventas y avisos contra Postgres real: qué se anonimiza, qué se borra y qué queda. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CheckpointerService } from '../conversation/checkpointer.provider.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { DIAS_RETENCION_AVISOS_LEIDOS, DIAS_RETENCION_DATOS_CLIENTE, fechaLimite } from './retention.rules.js';
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

  it('a los 12 meses una venta pierde nombre y teléfono, pero conserva montos e ítems', async () => {
    const vieja = await venta(pasado(DIAS_RETENCION_DATOS_CLIENTE));
    const nueva = await venta(reciente(DIAS_RETENCION_DATOS_CLIENTE));

    await servicio['anonimizarVentas'](AHORA);

    const [trasVieja, trasNueva] = await Promise.all(
      [vieja.id, nueva.id].map((id) => prisma.venta.findUniqueOrThrow({ where: { id }, include: { items: true } })),
    );
    expect(trasVieja).toMatchObject({ nombreCliente: null, telefonoCliente: null, totalCentavos: 1_000_000, estado: 'pagada' });
    expect(trasVieja.items).toHaveLength(1);
    expect(trasNueva).toMatchObject({ nombreCliente: 'Ana', telefonoCliente: '5491122334455' });
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
});
