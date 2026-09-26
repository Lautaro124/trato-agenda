/** Avisos contra Postgres real: la deduplicación por clave y los contadores. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { NotificacionesService } from './notificaciones.service.js';

describe.skipIf(!hayBaseDePrueba)('notificaciones (Postgres real)', () => {
  let prisma: PrismaService;
  let servicio: NotificacionesService;
  let dueno: User;
  let otro: User;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    servicio = new NotificacionesService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('guarda el aviso, lo manda por el canal y no repite uno igual sin leer', async () => {
    const canal = vi.fn().mockResolvedValue(true);
    servicio.usarCanal(canal);
    const aviso = { tipo: 'stock_bajo' as const, titulo: 'Stock bajo: Mate', cuerpo: 'Quedan 2.', clave: 'stock:v-1' };

    expect(await servicio.avisar(dueno.id, aviso)).not.toBeNull();
    expect(await servicio.avisar(dueno.id, aviso)).toBeNull();
    expect(canal).toHaveBeenCalledOnce();
    expect(canal).toHaveBeenCalledWith(dueno.id, 'Stock bajo: Mate\nQuedan 2.');

    // Leído, el mismo aviso vuelve a poder llegar.
    await servicio.marcarTodas(dueno.id);
    expect(await servicio.avisar(dueno.id, aviso)).not.toBeNull();
  });

  it('si el canal falla, el aviso igual queda en el panel', async () => {
    servicio.usarCanal(vi.fn().mockRejectedValue(new Error('sin socket')));
    expect(await servicio.avisar(dueno.id, { tipo: 'venta_pagada', titulo: 'Venta', cuerpo: '.' })).not.toBeNull();
  });

  it('cuenta, lista y marca como leídas sólo las propias', async () => {
    const antes = await servicio.noLeidas(dueno.id);
    const propia = await servicio.avisar(dueno.id, { tipo: 'consulta_derivada', titulo: 'Consulta', cuerpo: '.' });
    expect(await servicio.noLeidas(dueno.id)).toBe(antes + 1);

    expect(await servicio.marcarLeida(otro.id, propia!.id)).toBe(false);
    expect(await servicio.marcarLeida(dueno.id, propia!.id)).toBe(true);
    expect(await servicio.noLeidas(dueno.id)).toBe(antes);

    const listado = await servicio.listar(dueno.id);
    expect(listado.notificaciones[0].id).toBe(propia!.id);
    expect(listado.total).toBeGreaterThanOrEqual(3);
    expect((await servicio.listar(otro.id)).total).toBe(0);
  });

  it('detecta una consulta reciente de la misma conversación', async () => {
    await servicio.avisar(dueno.id, { tipo: 'consulta_derivada', titulo: 'Consulta', cuerpo: '.', clave: 'consulta:c-1' });
    expect(await servicio.consultaRecienteDe(dueno.id, 'c-1')).toBe(true);
    expect(await servicio.consultaRecienteDe(dueno.id, 'c-2')).toBe(false);
    expect(await servicio.consultaRecienteDe(dueno.id, 'c-1', new Date(Date.now() + 7 * 60 * 60 * 1000))).toBe(false);
  });
});
