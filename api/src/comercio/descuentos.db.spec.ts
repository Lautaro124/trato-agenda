/**
 * Promos contra Postgres real: que cada cuenta sólo vea y toque las suyas, que
 * el descuento de un producto no se edite desde acá y el tope por cuenta. Ver
 * test/base-de-prueba.ts.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { MAX_PROMOCIONES } from './descuentos.rules.js';
import { DescuentosService } from './descuentos.service.js';

describe.skipIf(!hayBaseDePrueba)('promociones (Postgres real)', () => {
  let prisma: PrismaService;
  let descuentos: DescuentosService;
  let dueno: User;
  let otroDueno: User;
  const promo = { nombre: 'Semana del mate', tipo: 'porcentaje' as const, valor: 10, categoria: 'Mates', desde: '2026-10-06', hasta: '2026-10-12' };

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    descuentos = new DescuentosService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otroDueno = await crearUsuarioDePrueba(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otroDueno.id] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.descuento.deleteMany({ where: { userId: { in: [dueno.id, otroDueno.id] } } });
  });

  it('crea, lista, pausa y borra una promo, con las fechas como se cargaron', async () => {
    const creada = await descuentos.crear(dueno.id, promo);
    expect(creada).toMatchObject({
      alcance: 'categoria',
      nombre: 'Semana del mate',
      categoria: 'Mates',
      etiqueta: '10% off',
      activo: true,
      desde: '2026-10-06',
      hasta: '2026-10-12',
    });
    expect(await descuentos.listar(dueno.id)).toHaveLength(1);
    expect(await descuentos.listar(otroDueno.id)).toEqual([]);

    expect((await descuentos.activar(dueno.id, creada.id, false)).activo).toBe(false);
    const todoElCatalogo = await descuentos.actualizar(dueno.id, creada.id, { ...promo, categoria: null, tipo: 'monto', valor: 50_000 });
    expect(todoElCatalogo).toMatchObject({ alcance: 'catalogo', etiqueta: '$ 500 off', categoria: null });

    await descuentos.eliminar(dueno.id, creada.id);
    expect(await descuentos.listar(dueno.id)).toEqual([]);
  });

  it('no deja tocar promos de otra cuenta ni el descuento de un producto', async () => {
    const ajena = await descuentos.crear(otroDueno.id, promo);
    await expect(descuentos.activar(dueno.id, ajena.id, false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(descuentos.actualizar(dueno.id, ajena.id, promo)).rejects.toBeInstanceOf(NotFoundException);
    await expect(descuentos.eliminar(dueno.id, ajena.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await prisma.descuento.findUniqueOrThrow({ where: { id: ajena.id } })).activo).toBe(true);

    const producto = await prisma.producto.create({
      data: { userId: dueno.id, codigo: 'P-DESC', nombre: 'Con descuento', variantes: { create: [{ sku: 'P', precioCentavos: 100 }] } },
    });
    const delProducto = await prisma.descuento.create({
      data: { userId: dueno.id, productoId: producto.id, tipo: 'porcentaje', valor: 10 },
    });
    await expect(descuentos.eliminar(dueno.id, delProducto.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await descuentos.listar(dueno.id)).toEqual([]);
    await prisma.producto.delete({ where: { id: producto.id } });
  });

  it(`frena en ${MAX_PROMOCIONES} promos por cuenta`, async () => {
    await prisma.descuento.createMany({
      data: Array.from({ length: MAX_PROMOCIONES }, (_, indice) => ({
        userId: dueno.id,
        nombre: `Promo ${indice}`,
        tipo: 'porcentaje',
        valor: 5,
      })),
    });
    await expect(descuentos.crear(dueno.id, promo)).rejects.toBeInstanceOf(ConflictException);
  });
});
