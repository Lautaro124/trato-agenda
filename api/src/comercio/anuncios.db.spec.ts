/**
 * Anuncios contra Postgres real (LAU-103): los que carga el dueño antes del
 * primer chat, cómo los reconoce ese chat y que cada cuenta sólo toque los
 * suyos. Ver test/base-de-prueba.ts.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { ReferenciaAnuncio } from './anuncios.rules.js';
import { AnunciosService } from './anuncios.service.js';
import type { BusquedaService } from './busqueda.service.js';
import type { DecisionesClient } from './decisiones.client.js';
import type { VisionClient } from './vision.client.js';

describe.skipIf(!hayBaseDePrueba)('anuncios (Postgres real)', () => {
  let prisma: PrismaService;
  let anuncios: AnunciosService;
  let dueno: User;
  let otroDueno: User;
  let productoId: string;
  const busqueda = { buscar: vi.fn().mockResolvedValue([]) };
  const vision = { configurado: false, describir: vi.fn() };

  const desdeAnuncio = (sourceId: string, sourceUrl: string | null = null): ReferenciaAnuncio => ({
    sourceId,
    sourceType: 'ad',
    sourceUrl,
    titulo: 'Rinconero brick 3c',
    cuerpo: null,
    miniatura: null,
  });

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    anuncios = new AnunciosService(
      prisma,
      busqueda as unknown as BusquedaService,
      vision as unknown as VisionClient,
      { configurado: false } as unknown as DecisionesClient,
    );
    dueno = await crearUsuarioDePrueba(prisma);
    otroDueno = await crearUsuarioDePrueba(prisma);
    ({ id: productoId } = await prisma.producto.create({
      data: { userId: dueno.id, codigo: 'RB3', nombre: 'Rinconero brick 3c', precioCentavos: 66_000_000, stock: 3 },
    }));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otroDueno.id] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.anuncio.deleteMany({ where: { userId: { in: [dueno.id, otroDueno.id] } } });
    busqueda.buscar.mockClear();
  });

  it('uno cargado con el ID llega al chat con el producto, sin volver a buscarlo', async () => {
    const cargado = await anuncios.crear(dueno.id, '120210000000000001', productoId, 'Promo rinconero');
    expect(cargado).toMatchObject({ asociacion: 'manual', chats: 0, ultimoChatAt: null, titulo: 'Promo rinconero' });

    const id = await anuncios.registrar(dueno.id, 'jid-1', desdeAnuncio('120210000000000001'));

    expect(id).toBe(cargado.id);
    expect(busqueda.buscar).not.toHaveBeenCalled();
    const [fila] = await anuncios.listar(dueno.id);
    expect(fila).toMatchObject({ asociacion: 'manual', chats: 1, titulo: 'Rinconero brick 3c', producto: { id: productoId } });
  });

  it('uno cargado con el link lo reconoce el primer chat, y otro anuncio de la misma publicación hereda el producto', async () => {
    const cargado = await anuncios.crear(dueno.id, 'https://www.facebook.com/ifreedom/posts/555', productoId, null);

    const primero = await anuncios.registrar(dueno.id, 'jid-1', desdeAnuncio('ad-1', 'https://m.facebook.com/ifreedom/posts/555/?fbclid=x'));
    const segundo = await anuncios.registrar(dueno.id, 'jid-2', desdeAnuncio('ad-2', 'https://facebook.com/ifreedom/posts/555'));

    expect(primero).toBe(cargado.id);
    expect(segundo).not.toBe(cargado.id);
    const lista = await anuncios.listar(dueno.id);
    expect(lista).toHaveLength(2);
    expect(lista.every((anuncio) => anuncio.asociacion === 'manual' && anuncio.producto?.id === productoId)).toBe(true);
    expect(busqueda.buscar).not.toHaveBeenCalled();
  });

  it('no duplica un anuncio ya cargado, ni por ID ni por link; otra cuenta sí puede cargar el suyo', async () => {
    await anuncios.crear(dueno.id, '120210000000000002', productoId, null);
    await expect(anuncios.crear(dueno.id, '120210000000000002', productoId, null)).rejects.toBeInstanceOf(ConflictException);
    await anuncios.crear(dueno.id, 'fb.me/abc', productoId, null);
    await expect(anuncios.crear(dueno.id, 'https://fb.me/abc/', productoId, null)).rejects.toBeInstanceOf(ConflictException);

    const ajeno = await prisma.producto.create({
      data: { userId: otroDueno.id, codigo: 'X1', nombre: 'Otro', precioCentavos: 100, stock: 1 },
    });
    await expect(anuncios.crear(otroDueno.id, '120210000000000002', ajeno.id, null)).resolves.toBeDefined();
    await expect(anuncios.crear(otroDueno.id, 'fb.me/zzz', productoId, null)).rejects.toThrow('no está en tu catálogo');
  });

  it('los recién cargados van arriba; sólo se quitan los propios y sin consultas', async () => {
    const conChat = await anuncios.registrar(dueno.id, 'jid-1', desdeAnuncio('ad-9'));
    const cargado = await anuncios.crear(dueno.id, 'fb.me/nuevo', productoId, null);

    expect((await anuncios.listar(dueno.id)).map((anuncio) => anuncio.id)).toEqual([cargado.id, conChat]);

    await expect(anuncios.eliminar(otroDueno.id, cargado.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(anuncios.eliminar(dueno.id, conChat)).rejects.toBeInstanceOf(NotFoundException);
    await anuncios.eliminar(dueno.id, cargado.id);
    expect((await anuncios.listar(dueno.id)).map((anuncio) => anuncio.id)).toEqual([conChat]);
  });
});
