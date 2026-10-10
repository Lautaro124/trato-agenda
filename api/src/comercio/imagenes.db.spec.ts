/**
 * Fotos de productos contra Postgres real: el tope por cuenta se cuenta en una
 * transacción con FOR UPDATE, y eso un Prisma de mentira no lo prueba. Ver
 * test/base-de-prueba.ts.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { MAX_IMAGENES_POR_CUENTA } from './imagenes.rules.js';
import { ImagenesService } from './imagenes.service.js';
import type { IndexadorService } from './indexador.service.js';
import { ProductosService } from './productos.service.js';

const foto = () =>
  sharp({ create: { width: 1000, height: 500, channels: 3, background: '#c0392b' } })
    .png()
    .toBuffer();

describe.skipIf(!hayBaseDePrueba)('fotos de productos (Postgres real)', () => {
  let prisma: PrismaService;
  let imagenes: ImagenesService;
  let productos: ProductosService;
  const usuarios: User[] = [];

  async function duenoConProductos(cantidad: number): Promise<{ dueno: User; ids: string[] }> {
    const dueno = await crearUsuarioDePrueba(prisma);
    usuarios.push(dueno);
    const ids: string[] = [];
    for (let i = 0; i < cantidad; i++) {
      const producto = await prisma.producto.create({ data: { userId: dueno.id, codigo: `P-${i}`, nombre: `Producto ${i}` } });
      ids.push(producto.id);
    }
    return { dueno, ids };
  }

  /** Llena el cupo sin pasar por sharp: lo que se prueba acá es el conteo. */
  async function conFotosDePrueba(dueno: User, ids: string[]): Promise<void> {
    await prisma.imagenProducto.createMany({
      data: ids.map((productoId) => ({ userId: dueno.id, productoId, datos: new Uint8Array([1]), bytes: 1, ancho: 1, alto: 1 })),
    });
  }

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    imagenes = new ImagenesService(prisma);
    productos = new ProductosService(prisma, { programar: () => undefined } as unknown as IndexadorService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: usuarios.map((usuario) => usuario.id) } } });
    await prisma.$disconnect();
  });

  it('guarda la foto recomprimida y la devuelve sólo a su dueño', async () => {
    const { dueno, ids } = await duenoConProductos(1);
    const otro = await crearUsuarioDePrueba(prisma);
    usuarios.push(otro);

    const guardada = await imagenes.guardar(dueno.id, ids[0], await foto());

    expect(guardada).toMatchObject({ ancho: 800, alto: 400 });
    const datos = await imagenes.obtener(dueno.id, ids[0]);
    expect((await sharp(datos).metadata()).format).toBe('jpeg');
    expect(datos.length).toBe(guardada.bytes);
    await expect(imagenes.obtener(otro.id, ids[0])).rejects.toBeInstanceOf(NotFoundException);
    await expect(imagenes.guardar(otro.id, ids[0], await foto())).rejects.toBeInstanceOf(NotFoundException);
    expect(await imagenes.paraEnviar(otro.id, ids[0])).toBeNull();
    expect(await imagenes.estadoDeFoto(dueno.id, ids[0])).toEqual({ nombre: 'Producto 0', tieneFoto: true });

    const listado = await productos.listar(dueno.id, {});
    expect(listado.productos[0].imagenActualizada).toBeInstanceOf(Date);
  });

  it(`no deja pasar de ${MAX_IMAGENES_POR_CUENTA} productos con foto, pero reemplazar no suma`, async () => {
    const { dueno, ids } = await duenoConProductos(MAX_IMAGENES_POR_CUENTA + 1);
    await conFotosDePrueba(dueno, ids.slice(0, MAX_IMAGENES_POR_CUENTA));

    await expect(imagenes.guardar(dueno.id, ids[MAX_IMAGENES_POR_CUENTA], await foto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(imagenes.guardar(dueno.id, ids[0], await foto())).resolves.toMatchObject({ ancho: 800 });
    expect(await imagenes.uso(dueno.id)).toEqual({ usadas: MAX_IMAGENES_POR_CUENTA, maximo: MAX_IMAGENES_POR_CUENTA });
  });

  it('dos subidas a la vez con un solo lugar libre: entra una sola', async () => {
    const { dueno, ids } = await duenoConProductos(MAX_IMAGENES_POR_CUENTA + 1);
    await conFotosDePrueba(dueno, ids.slice(0, MAX_IMAGENES_POR_CUENTA - 1));
    const archivo = await foto();

    const resultados = await Promise.allSettled([
      imagenes.guardar(dueno.id, ids[MAX_IMAGENES_POR_CUENTA - 1], archivo),
      imagenes.guardar(dueno.id, ids[MAX_IMAGENES_POR_CUENTA], archivo),
    ]);

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    expect(await imagenes.uso(dueno.id)).toMatchObject({ usadas: MAX_IMAGENES_POR_CUENTA });
  });

  it('dar de baja el producto borra su foto y libera el lugar; borrar la cuenta se lleva todo', async () => {
    const { dueno, ids } = await duenoConProductos(2);
    await imagenes.guardar(dueno.id, ids[0], await foto());
    await imagenes.guardar(dueno.id, ids[1], await foto());

    await productos.eliminar(dueno.id, ids[0]);
    expect(await imagenes.uso(dueno.id)).toMatchObject({ usadas: 1 });
    expect(await imagenes.estadoDeFoto(dueno.id, ids[0])).toBeNull();

    await imagenes.borrar(dueno.id, ids[1]);
    expect(await imagenes.uso(dueno.id)).toMatchObject({ usadas: 0 });

    await imagenes.guardar(dueno.id, ids[1], await foto());
    await prisma.user.delete({ where: { id: dueno.id } });
    expect(await prisma.imagenProducto.count({ where: { userId: dueno.id } })).toBe(0);
  });
});
