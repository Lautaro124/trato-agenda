import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ImagenInvalidaError,
  MAX_IMAGENES_POR_CUENTA,
  MAX_IMAGENES_POR_PRODUCTO,
  procesarImagen,
  type ImagenProcesada,
} from './imagenes.rules.js';

export type ImagenGuardada = { bytes: number; ancho: number; alto: number };

export type UsoDeImagenes = { usadas: number; maximo: number };

/** Una foto del producto, sin los bytes: la primera de la lista es la principal. */
export type FotoDeProducto = { id: string; actualizada: Date };

/** La foto que el asistente le manda a un cliente: sólo la de un producto activo de la cuenta. */
export type ImagenParaEnviar = { datos: Buffer; nombre: string };

/**
 * Lo que sabe el asistente de las fotos de un producto, sin los bytes:
 * `detalles` son los ids de las que no son la principal, en orden.
 */
export type EstadoDeFoto = { nombre: string; tieneFoto: boolean; detalles: string[] };

type Tx = Prisma.TransactionClient;

/** El orden en que se muestran: `orden` y, ante un empate, la más vieja primero. */
export const ORDEN_FOTOS: Prisma.ImagenProductoOrderByWithRelationInput[] = [{ orden: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];

/**
 * Fotos de productos: hasta `MAX_IMAGENES_POR_PRODUCTO` por producto (la de
 * menor `orden` es la principal) y `MAX_IMAGENES_POR_CUENTA` por cuenta
 * (imagenes.rules.ts). Todo va scopeado al dueño; ninguna lectura de listado
 * trae los bytes, sólo `obtener` y `paraEnviar`.
 *
 * Lo que cambia las fotos de un producto bloquea antes la cuenta y después el
 * producto (siempre en ese orden): dos cambios a la vez se esperan, el tope
 * no se pasa y `orden` queda 0..n-1 sin huecos.
 */
@Injectable()
export class ImagenesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Suma una foto al final; si el producto no tenía, queda como la principal. */
  async agregar(userId: string, productoId: string, archivo: Buffer): Promise<FotoDeProducto[]> {
    await this.productoPropio(userId, productoId);
    const imagen = await procesar(archivo);
    return this.prisma.$transaction(async (tx) => {
      const fotos = await this.bloquear(tx, userId, productoId);
      if (fotos.length >= MAX_IMAGENES_POR_PRODUCTO) {
        throw new ConflictException(
          `Un producto puede tener hasta ${MAX_IMAGENES_POR_PRODUCTO} fotos. Quitá una para subir otra.`,
        );
      }
      await this.reservarCupo(tx, userId);
      await tx.imagenProducto.create({ data: { userId, productoId, orden: fotos.length, ...fila(imagen) } });
      return fotosDe(tx, productoId);
    });
  }

  /** Cambia los bytes de una foto sin moverla de lugar. No suma al cupo. */
  async reemplazar(userId: string, productoId: string, imagenId: string, archivo: Buffer): Promise<FotoDeProducto[]> {
    await this.productoPropio(userId, productoId);
    const imagen = await procesar(archivo);
    return this.prisma.$transaction(async (tx) => {
      const fotos = await this.bloquear(tx, userId, productoId);
      if (!fotos.some((foto) => foto.id === imagenId)) throw new NotFoundException('Esa foto no existe.');
      await tx.imagenProducto.update({ where: { id: imagenId }, data: fila(imagen) });
      return fotosDe(tx, productoId);
    });
  }

  /**
   * La foto principal: la reemplaza o, si el producto no tiene ninguna, la
   * crea. Es lo que usa la importación, que guarda una sola.
   */
  async guardarPrincipal(userId: string, productoId: string, archivo: Buffer): Promise<ImagenGuardada> {
    await this.productoPropio(userId, productoId);
    const imagen = await procesar(archivo);
    await this.prisma.$transaction(async (tx) => {
      const [principal] = await this.bloquear(tx, userId, productoId);
      if (principal) {
        await tx.imagenProducto.update({ where: { id: principal.id }, data: fila(imagen) });
        return;
      }
      await this.reservarCupo(tx, userId);
      await tx.imagenProducto.create({ data: { userId, productoId, orden: 0, ...fila(imagen) } });
    });
    return { bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
  }

  /** Pasa una foto al primer lugar; las demás conservan su orden entre sí. */
  async hacerPrincipal(userId: string, productoId: string, imagenId: string): Promise<FotoDeProducto[]> {
    await this.productoPropio(userId, productoId);
    return this.prisma.$transaction(async (tx) => {
      const fotos = await this.bloquear(tx, userId, productoId);
      const elegida = fotos.find((foto) => foto.id === imagenId);
      if (!elegida) throw new NotFoundException('Esa foto no existe.');
      await reordenar(tx, [elegida, ...fotos.filter((foto) => foto.id !== imagenId)]);
      return fotosDe(tx, productoId);
    });
  }

  /** Quita una foto; si era la principal, la siguiente pasa a serlo. */
  async quitar(userId: string, productoId: string, imagenId: string): Promise<FotoDeProducto[]> {
    await this.productoPropio(userId, productoId);
    return this.prisma.$transaction(async (tx) => {
      const fotos = await this.bloquear(tx, userId, productoId);
      if (!fotos.some((foto) => foto.id === imagenId)) throw new NotFoundException('Esa foto no existe.');
      await tx.imagenProducto.delete({ where: { id: imagenId } });
      await reordenar(tx, fotos.filter((foto) => foto.id !== imagenId));
      return fotosDe(tx, productoId);
    });
  }

  /** Quita la principal (la siguiente pasa a serlo). Sin fotos, no hace nada. */
  async quitarPrincipal(userId: string, productoId: string): Promise<void> {
    const principal = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId },
      orderBy: ORDEN_FOTOS,
      select: { id: true },
    });
    if (!principal) return;
    await this.quitar(userId, productoId, principal.id).catch((error: unknown) => {
      // Otro pedido la quitó en el medio: el resultado es el mismo.
      if (!(error instanceof NotFoundException)) throw error;
    });
  }

  /** Los bytes de una foto (la principal sin `imagenId`), para el panel y el banco de pruebas. */
  async obtener(userId: string, productoId: string, imagenId?: string): Promise<Buffer> {
    const imagen = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId, ...(imagenId ? { id: imagenId } : {}) },
      orderBy: ORDEN_FOTOS,
      select: { datos: true },
    });
    if (!imagen) throw new NotFoundException('Ese producto no tiene esa foto.');
    return Buffer.from(imagen.datos);
  }

  /**
   * La foto para mandar por WhatsApp (la principal sin `imagenId`), o null si
   * el producto no es de la cuenta, está dado de baja o no la tiene.
   */
  async paraEnviar(userId: string, productoId: string, imagenId?: string): Promise<ImagenParaEnviar | null> {
    const imagen = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId, producto: { activo: true }, ...(imagenId ? { id: imagenId } : {}) },
      orderBy: ORDEN_FOTOS,
      select: { datos: true, producto: { select: { nombre: true } } },
    });
    return imagen ? { datos: Buffer.from(imagen.datos), nombre: imagen.producto.nombre } : null;
  }

  /**
   * Para el asistente, sin leer los bytes: el nombre del producto, si tiene
   * foto y cuáles son las de detalle, o null si no es un producto activo de
   * la cuenta.
   */
  async estadoDeFoto(userId: string, productoId: string): Promise<EstadoDeFoto | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { nombre: true, imagenes: { select: { id: true }, orderBy: ORDEN_FOTOS } },
    });
    if (!producto) return null;
    const [principal, ...detalles] = producto.imagenes;
    return { nombre: producto.nombre, tieneFoto: principal !== undefined, detalles: detalles.map((foto) => foto.id) };
  }

  async uso(userId: string): Promise<UsoDeImagenes> {
    return { usadas: await usadasPor(this.prisma, userId), maximo: MAX_IMAGENES_POR_CUENTA };
  }

  /**
   * Bloquea la cuenta y el producto, en ese orden, y devuelve sus fotos en
   * orden. El `FOR UPDATE` de la cuenta hace esperar a dos subidas de la
   * misma cuenta (si no, las dos contarían 99 y quedarían 101); el del
   * producto, a dos cambios del mismo producto.
   */
  private async bloquear(tx: Tx, userId: string, productoId: string): Promise<Array<{ id: string; orden: number }>> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const producto = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Producto" WHERE "id" = ${productoId} AND "userId" = ${userId} AND "activo" = true FOR UPDATE`;
    if (producto.length === 0) throw new NotFoundException('No existe ese producto.');
    return tx.imagenProducto.findMany({ where: { productoId, userId }, orderBy: ORDEN_FOTOS, select: { id: true, orden: true } });
  }

  private async reservarCupo(tx: Tx, userId: string): Promise<void> {
    if ((await usadasPor(tx, userId)) >= MAX_IMAGENES_POR_CUENTA) {
      throw new ConflictException(
        `Llegaste al máximo de ${MAX_IMAGENES_POR_CUENTA} fotos de la cuenta. Quitá alguna para subir esta.`,
      );
    }
  }

  private async productoPropio(userId: string, productoId: string): Promise<void> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('No existe ese producto.');
  }
}

/** Las fotos que ocupan cupo. */
function usadasPor(prisma: Pick<Tx, 'imagenProducto'>, userId: string): Promise<number> {
  return prisma.imagenProducto.count({ where: { userId } });
}

function fotosDe(tx: Tx, productoId: string): Promise<FotoDeProducto[]> {
  return tx.imagenProducto
    .findMany({ where: { productoId }, orderBy: ORDEN_FOTOS, select: { id: true, updatedAt: true } })
    .then((fotos) => fotos.map((foto) => ({ id: foto.id, actualizada: foto.updatedAt })));
}

/** Deja `orden` 0..n-1 en el orden dado, tocando sólo las que cambian. */
async function reordenar(tx: Tx, fotos: Array<{ id: string; orden: number }>): Promise<void> {
  for (const [indice, foto] of fotos.entries()) {
    if (foto.orden !== indice) await tx.imagenProducto.update({ where: { id: foto.id }, data: { orden: indice } });
  }
}

function fila(imagen: ImagenProcesada) {
  return { datos: new Uint8Array(imagen.datos), bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
}

async function procesar(archivo: Buffer): Promise<ImagenProcesada> {
  try {
    return await procesarImagen(archivo);
  } catch (error) {
    if (error instanceof ImagenInvalidaError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}
