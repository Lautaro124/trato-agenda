import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ReferenciaAnuncio } from './anuncios.rules.js';
import { AnunciosService, MAX_ANUNCIOS_NUEVOS_POR_HORA } from './anuncios.service.js';
import type { BusquedaService } from './busqueda.service.js';
import type { DecisionesClient } from './decisiones.client.js';
import type { VisionClient } from './vision.client.js';

import { procesarImagen } from './imagenes.rules.js';

vi.mock('./imagenes.rules.js', async (original) => ({
  ...(await original<typeof import('./imagenes.rules.js')>()),
  procesarImagen: vi.fn(async (datos: Buffer) => ({ datos, bytes: datos.length, ancho: 10, alto: 10 })),
}));

const REF: ReferenciaAnuncio = {
  sourceId: 'ad-1',
  sourceType: 'ad',
  sourceUrl: null,
  titulo: 'Rinconero brick 3c',
  cuerpo: 'Envío incluido',
  miniatura: Buffer.from('jpeg'),
};

const RINCONERO = { productoId: 'p-1', nombre: 'Rinconero brick 3c', codigo: 'RB3' };
const SILLON = { productoId: 'p-2', nombre: 'Sillón Nube', codigo: 'SN' };

type Fila = {
  id: string;
  asociacion: string;
  titulo: string | null;
  cuerpo: string | null;
  miniatura: Uint8Array | null;
  descripcionMiniatura: string | null;
};

function crear(fila: Partial<Fila> = {}) {
  const anuncio: Fila = {
    id: 'a-1',
    asociacion: 'pendiente',
    titulo: REF.titulo,
    cuerpo: REF.cuerpo,
    miniatura: new Uint8Array(Buffer.from('jpeg')),
    descripcionMiniatura: null,
    ...fila,
  };
  const prisma = {
    anuncio: {
      upsert: vi.fn().mockResolvedValue({ id: anuncio.id, asociacion: anuncio.asociacion }),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(anuncio),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conversation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    producto: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        { id: 'p-1', nombre: 'Rinconero brick 3c', descripcion: '' },
        { id: 'p-2', nombre: 'Sillón Nube', descripcion: 'Gris' },
      ]),
    },
  };
  const busqueda = { buscar: vi.fn().mockResolvedValue([RINCONERO, SILLON]) };
  const vision = { configurado: true, describir: vi.fn().mockResolvedValue('Sillón gris, dice "Rinconero brick 3c"') };
  const decisiones = {
    configurado: true,
    probabilidades: vi.fn().mockResolvedValue({ p0: 0.9, p1: 0.05, none: 0.05 }),
  };
  const service = new AnunciosService(
    prisma as unknown as PrismaService,
    busqueda as unknown as BusquedaService,
    vision as unknown as VisionClient,
    decisiones as unknown as DecisionesClient,
  );
  return { service, prisma, busqueda, vision, decisiones };
}

describe('AnunciosService.registrar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('guarda el anuncio, lo vincula a una conversación existente sin crearla y lo asocia por el texto', async () => {
    const { service, prisma, busqueda, vision } = crear();

    await expect(service.registrar('u-1', 'jid', REF)).resolves.toBe('a-1');

    expect(prisma.anuncio.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_sourceId: { userId: 'u-1', sourceId: 'ad-1' } } }),
    );
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', remoteJid: 'jid' },
      data: expect.objectContaining({ anuncioId: 'a-1' }),
    });
    expect(busqueda.buscar).toHaveBeenCalledWith('u-1', 'Rinconero brick 3c Envío incluido');
    expect(vision.describir).not.toHaveBeenCalled();
    expect(prisma.anuncio.updateMany).toHaveBeenCalledWith({
      where: { id: 'a-1', userId: 'u-1', asociacion: 'pendiente' },
      data: { productoId: 'p-1', asociacion: 'automatica' },
    });
  });

  it('si el texto no nombra el producto, mira la miniatura una vez y Jev revisa dos veces: todo junto y la imagen sola', async () => {
    const { service, prisma, decisiones, vision } = crear({ titulo: '¡Sillones en oferta!', cuerpo: null });

    await service.registrar('u-1', 'jid', REF);

    expect(vision.describir).toHaveBeenCalledTimes(1);
    expect(prisma.anuncio.updateMany).toHaveBeenCalledWith({
      where: { id: 'a-1', userId: 'u-1' },
      data: { descripcionMiniatura: 'Sillón gris, dice "Rinconero brick 3c"' },
    });
    expect(decisiones.probabilidades).toHaveBeenCalledTimes(2);
    const pedidos = decisiones.probabilidades.mock.calls.map(([pedido]) => pedido);
    expect(pedidos.map((p) => p.estado)).toEqual([
      '¡Sillones en oferta! Sillón gris, dice "Rinconero brick 3c"',
      'Sillón gris, dice "Rinconero brick 3c"',
    ]);
    expect(pedidos[0].opciones).toEqual({ p0: 'Product "Rinconero brick 3c"', p1: 'Product "Sillón Nube": "Gris"' });
    expect(prisma.anuncio.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'a-1', userId: 'u-1', asociacion: 'pendiente' },
      data: { productoId: 'p-1', asociacion: 'automatica' },
    });
  });

  it('gana el promedio de las dos revisiones aunque una sola dude', async () => {
    const { service, prisma, decisiones } = crear({ titulo: 'Prueba estado', cuerpo: null });
    decisiones.probabilidades
      .mockResolvedValueOnce({ p0: 0.43, p1: 0.05, none: 0.43 })
      .mockResolvedValueOnce({ p0: 0.48, p1: 0.04, none: 0.42 });
    await service.registrar('u-1', 'jid', REF);
    expect(prisma.anuncio.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'a-1', userId: 'u-1', asociacion: 'pendiente' },
      data: { productoId: 'p-1', asociacion: 'automatica' },
    });
  });

  it('con una sola fuente (sólo texto), Jev revisa una vez', async () => {
    const { service, decisiones, vision } = crear({ titulo: '¡Sillones en oferta!', cuerpo: null, miniatura: null });
    await service.registrar('u-1', 'jid', REF);
    expect(vision.describir).not.toHaveBeenCalled();
    expect(decisiones.probabilidades).toHaveBeenCalledTimes(1);
  });

  it('si "ninguna" gana o Jev falla, queda pendiente', async () => {
    for (const respuesta of [{ p0: 0.4, p1: 0.1, none: 0.5 }, { none: 0.9 }, new Error('503')]) {
      const { service, prisma, decisiones } = crear({ titulo: '¡Sillones en oferta!', cuerpo: null });
      if (respuesta instanceof Error) decisiones.probabilidades.mockRejectedValue(respuesta);
      else decisiones.probabilidades.mockResolvedValue(respuesta);
      await expect(service.registrar('u-1', 'jid', REF)).resolves.toBe('a-1');
      expect(prisma.anuncio.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ asociacion: 'automatica' }) }),
      );
    }
  });

  it('con más de 254 productos, Jev elige entre los que mejor puntúa la búsqueda', async () => {
    const { service, prisma, busqueda, decisiones } = crear({ titulo: '¡Sillones en oferta!', cuerpo: null });
    prisma.producto.findMany.mockResolvedValue(Array.from({ length: 255 }, (_, i) => ({ id: `x${i}`, nombre: `P${i}`, descripcion: '' })));
    busqueda.buscar.mockResolvedValue([{ ...SILLON, descripcion: '' }]);
    await service.registrar('u-1', 'jid', REF);
    expect(busqueda.buscar).toHaveBeenLastCalledWith('u-1', expect.any(String), { limite: 254 });
    expect(Object.keys(decisiones.probabilidades.mock.calls[0][0].opciones)).toEqual(['p0']);
  });

  it('no vuelve a mirar una miniatura ya descripta', async () => {
    const { service, vision } = crear({ titulo: '¡Sillones en oferta!', cuerpo: null, descripcionMiniatura: 'Sillón Nube' });
    await service.registrar('u-1', 'jid', REF);
    expect(vision.describir).not.toHaveBeenCalled();
  });

  it('con varias coincidencias o ninguna, queda pendiente sin inventar', async () => {
    const { service, prisma, vision, decisiones } = crear({ titulo: 'Rinconero brick 3c y Sillón Nube', cuerpo: null });
    vision.describir.mockResolvedValue('no se distingue');
    decisiones.probabilidades.mockResolvedValue({ none: 1 });

    await service.registrar('u-1', 'jid', REF);

    expect(prisma.anuncio.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ asociacion: 'automatica' }) }),
    );
  });

  it('un anuncio ya asociado (por el dueño o solo) no se vuelve a resolver', async () => {
    const { service, busqueda } = crear({ asociacion: 'manual' });
    await service.registrar('u-1', 'jid', REF);
    expect(busqueda.buscar).not.toHaveBeenCalled();
  });

  it('dos mensajes del mismo anuncio nuevo lo resuelven una sola vez', async () => {
    const { service, busqueda } = crear();
    await Promise.all([service.registrar('u-1', 'jid-1', REF), service.registrar('u-1', 'jid-2', REF)]);
    expect(busqueda.buscar).toHaveBeenCalledTimes(1);
  });

  it('si falla la búsqueda o la visión, el registro sigue', async () => {
    const { service, busqueda, vision } = crear({ titulo: 'Oferta', cuerpo: null });
    busqueda.buscar.mockRejectedValue(new Error('base caída'));
    vision.describir.mockRejectedValue(new Error('503'));
    await expect(service.registrar('u-1', 'jid', REF)).resolves.toBe('a-1');
  });
});

describe('AnunciosService.registrar — tope y imagen completa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('baja la imagen completa sólo la primera vez que llega el anuncio', async () => {
    const { service, prisma } = crear();
    const imagenCompleta = vi.fn().mockResolvedValue(Buffer.from('completa'));

    await service.registrar('u-1', 'jid', REF, imagenCompleta);
    expect(imagenCompleta).toHaveBeenCalledTimes(1);
    expect(prisma.anuncio.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ miniatura: new Uint8Array(Buffer.from('completa')) }) }),
    );

    prisma.anuncio.findUnique.mockResolvedValue({ id: 'a-1' });
    await service.registrar('u-1', 'jid', REF, imagenCompleta);
    expect(imagenCompleta).toHaveBeenCalledTimes(1);
  });

  it('si no se pudo bajar la imagen completa, queda la miniatura', async () => {
    const { service, prisma } = crear();
    await service.registrar('u-1', 'jid', REF, vi.fn().mockResolvedValue(null));
    expect(prisma.anuncio.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ miniatura: new Uint8Array(Buffer.from('jpeg')) }) }),
    );
  });

  it('pasado el tope de anuncios nuevos por hora no registra más, pero sí los que ya existen', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    for (let i = 0; i < MAX_ANUNCIOS_NUEVOS_POR_HORA; i++) {
      await expect(service.registrar('u-tope', 'jid', { ...REF, sourceId: `ad-${i}` })).resolves.toBe('a-1');
    }
    await expect(service.registrar('u-tope', 'jid', { ...REF, sourceId: 'ad-de-mas' })).resolves.toBeNull();
    expect(prisma.anuncio.upsert).toHaveBeenCalledTimes(MAX_ANUNCIOS_NUEVOS_POR_HORA);

    prisma.anuncio.findUnique.mockResolvedValue({ id: 'a-1' });
    await expect(service.registrar('u-tope', 'jid', REF)).resolves.toBe('a-1');
    // Otra cuenta tiene su propio tope.
    prisma.anuncio.findUnique.mockResolvedValue(null);
    await expect(service.registrar('u-otra', 'jid', { ...REF, sourceId: 'ad-x' })).resolves.toBe('a-1');
  });
});

describe('AnunciosService.asociar', () => {
  it('rechaza un producto que no es del usuario o no está activo', async () => {
    const { service, prisma } = crear();
    prisma.producto.findFirst.mockResolvedValue(null);
    await expect(service.asociar('u-1', 'a-1', 'p-ajeno')).rejects.toThrow('no está en tu catálogo');
    expect(prisma.producto.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-ajeno', userId: 'u-1', activo: true },
      select: { id: true },
    });
    expect(prisma.anuncio.updateMany).not.toHaveBeenCalled();
  });

  it('un anuncio de otra cuenta no se encuentra', async () => {
    const { service, prisma } = crear();
    prisma.anuncio.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.asociar('u-1', 'a-ajeno', null)).rejects.toThrow('No se encontró el anuncio');
    expect(prisma.anuncio.updateMany).toHaveBeenCalledWith({
      where: { id: 'a-ajeno', userId: 'u-1' },
      data: { productoId: null, asociacion: 'sin_producto' },
    });
  });
});

const conflicto = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

describe('AnunciosService.registrar con un anuncio que cargó el dueño', () => {
  beforeEach(() => vi.clearAllMocks());
  const conLink = { ...REF, sourceUrl: 'https://www.facebook.com/ifreedom/posts/123?fbclid=x' };

  it('cargado con el link y sin id: le pone el id y el upsert lo encuentra con su producto', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findFirst.mockResolvedValueOnce({ id: 'a-1', sourceId: null, productoId: 'p-1', asociacion: 'manual' });

    await service.registrar('u-1', 'jid', conLink);

    expect(prisma.anuncio.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', urlClave: 'facebook.com/ifreedom/posts/123' } }),
    );
    expect(prisma.anuncio.updateMany).toHaveBeenCalledWith({
      where: { id: 'a-1', userId: 'u-1', sourceId: null },
      data: { sourceId: 'ad-1' },
    });
    expect(prisma.anuncio.upsert.mock.calls[0][0].create).not.toHaveProperty('productoId');
  });

  it('otro anuncio de la misma publicación hereda el producto elegido', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findFirst.mockResolvedValueOnce({ id: 'a-0', sourceId: 'ad-0', productoId: 'p-1', asociacion: 'manual' });

    await service.registrar('u-1', 'jid', conLink);

    expect(prisma.anuncio.upsert.mock.calls[0][0].create).toMatchObject({ productoId: 'p-1', asociacion: 'manual' });
  });

  it('si ya había llegado un chat con ese id, queda esa fila y hereda el producto', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findFirst.mockResolvedValueOnce({ id: 'a-0', sourceId: null, productoId: 'p-1', asociacion: 'manual' });
    prisma.anuncio.updateMany.mockRejectedValueOnce(conflicto());

    await expect(service.registrar('u-1', 'jid', conLink)).resolves.toBe('a-1');
  });

  it('un anuncio ya guardado no se reescribe con lo que manda el cliente: sólo se completa lo que falta', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findUnique.mockResolvedValue({
      id: 'a-1',
      sourceType: 'ad',
      sourceUrl: null,
      titulo: 'Nombre del dueño',
      cuerpo: null,
      miniatura: new Uint8Array([1]),
    });
    await service.registrar('u-1', 'jid', { ...REF, titulo: 'Otro título', cuerpo: 'Texto nuevo', sourceUrl: 'https://fb.me/x', sourceType: 'x' });
    const { update } = prisma.anuncio.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ cuerpo: 'Texto nuevo', sourceUrl: 'https://fb.me/x' });
    expect(update).not.toHaveProperty('titulo');
    expect(update).not.toHaveProperty('miniatura');
    expect(update).not.toHaveProperty('sourceType');
  });

  it('el primer chat de un anuncio cargado con su link completa texto y miniatura, sin pisar el nombre del dueño', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    const delDueno = { id: 'a-0', sourceType: null, sourceUrl: null, titulo: 'Nombre del dueño', cuerpo: null, miniatura: null };
    prisma.anuncio.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(delDueno);
    prisma.anuncio.findFirst.mockResolvedValueOnce({ id: 'a-0', sourceId: null, productoId: 'p-1', asociacion: 'manual' });
    await service.registrar('u-1', 'jid', conLink);
    const { update } = prisma.anuncio.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ cuerpo: REF.cuerpo, miniatura: expect.any(Uint8Array) });
    expect(update).not.toHaveProperty('titulo');
  });

  it('con miniatura ya guardada no procesa otra', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findUnique.mockResolvedValue({ id: 'a-1', sourceType: 'ad', sourceUrl: null, titulo: 'x', cuerpo: 'y', miniatura: new Uint8Array([1]) });
    await service.registrar('u-1', 'jid', REF);
    expect(procesarImagen).not.toHaveBeenCalled();
  });

  it('lo que no vino en el mensaje no borra el nombre que le puso el dueño', async () => {
    const { service, prisma } = crear({ asociacion: 'manual' });
    prisma.anuncio.findUnique.mockResolvedValue({ id: 'a-1', sourceType: null, sourceUrl: null, titulo: 'Nombre del dueño', cuerpo: null, miniatura: null });
    await service.registrar('u-1', 'jid', { ...REF, titulo: null, miniatura: null });
    const { update } = prisma.anuncio.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty('titulo');
    expect(update).not.toHaveProperty('miniatura');
    expect(update).toHaveProperty('cuerpo', 'Envío incluido');
  });
});

describe('AnunciosService.crear', () => {
  beforeEach(() => vi.clearAllMocks());
  const FILA = {
    id: 'a-9',
    sourceId: '120210000000000001',
    sourceType: null,
    sourceUrl: null,
    titulo: 'Promo rinconero',
    cuerpo: null,
    miniatura: null,
    asociacion: 'manual',
    chats: 0,
    ultimoChatAt: null,
    producto: { id: 'p-1', nombre: 'Rinconero brick 3c', activo: true },
  };

  it('con el ID de Meta queda confirmado con el producto, sin chats todavía', async () => {
    const { service, prisma } = crear();
    prisma.producto.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.anuncio.create.mockResolvedValue(FILA);

    const anuncio = await service.crear('u-1', '120210000000000001', 'p-1', 'Promo\nrinconero');

    expect(prisma.anuncio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'u-1',
          sourceId: '120210000000000001',
          sourceUrl: null,
          urlClave: null,
          titulo: 'Promo rinconero',
          productoId: 'p-1',
          asociacion: 'manual',
        },
      }),
    );
    expect(anuncio).toMatchObject({ id: 'a-9', chats: 0, ultimoChatAt: null, tieneMiniatura: false });
  });

  it('rechaza algo que no es un link ni un ID, y un producto ajeno', async () => {
    const { service, prisma } = crear();
    await expect(service.crear('u-1', 'el del sillón', 'p-1', null)).rejects.toBeInstanceOf(UnprocessableEntityException);
    prisma.producto.findFirst.mockResolvedValue(null);
    await expect(service.crear('u-1', 'fb.me/abc', 'p-ajeno', null)).rejects.toThrow('no está en tu catálogo');
    expect(prisma.anuncio.create).not.toHaveBeenCalled();
  });

  it('uno que ya está en la lista no se duplica', async () => {
    const { service, prisma } = crear();
    prisma.producto.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.anuncio.create.mockRejectedValue(conflicto());
    await expect(service.crear('u-1', 'fb.me/abc', 'p-1', null)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AnunciosService.eliminar', () => {
  it('sólo quita anuncios propios y sin consultas', async () => {
    const { service, prisma } = crear();
    prisma.anuncio.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.eliminar('u-1', 'a-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.anuncio.deleteMany).toHaveBeenCalledWith({ where: { id: 'a-1', userId: 'u-1', chats: 0 } });
  });
});
