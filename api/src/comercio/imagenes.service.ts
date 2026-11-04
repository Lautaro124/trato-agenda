import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImagenInvalidaError, MAX_IMAGENES_POR_CUENTA, procesarImagen, type ImagenProcesada } from './imagenes.rules.js';

export type ImagenGuardada = { bytes: number; ancho: number; alto: number };

export type UsoDeImagenes = { usadas: number; maximo: number };

/** La foto que el asistente le manda a un cliente: sólo la de un producto activo de la cuenta. */
export type ImagenParaEnviar = { datos: Buffer; nombre: string };

/** Lo que sabe el asistente de la foto que quiere mandar, sin los bytes. */
export type EstadoDeFoto = { nombre: string; tieneFoto: boolean };

type Tx = Prisma.TransactionClient;

/**
 * Fotos de productos: una por producto y hasta `MAX_IMAGENES_POR_CUENTA` por cuenta
 * (imagenes.rules.ts). Todo va scopeado al dueño; ninguna lectura de listado
 * trae los bytes, sólo `obtener` y `paraEnviar`.
 */
@Injectable()
export class ImagenesService {
  constructor(private readonly prisma: PrismaService) {}

  async guardar(userId: string, productoId: string, archivo: Buffer): Promise<ImagenGuardada> {
    await this.productoPropio(userId, productoId);

    const imagen = await procesar(archivo);

    await this.prisma.$transaction(async (tx) => {
      const yaTiene = await tx.imagenProducto.findUnique({ where: { productoId }, select: { id: true } });
      await this.reservarCupo(tx, userId, yaTiene !== null);
      const fila = { datos: new Uint8Array(imagen.datos), bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
      await tx.imagenProducto.upsert({
        where: { productoId },
        create: { userId, productoId, ...fila },
        update: fila,
      });
    });
    return { bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
  }

  async borrar(userId: string, productoId: string): Promise<void> {
    await this.prisma.imagenProducto.deleteMany({ where: { userId, productoId } });
  }

  /** Los bytes de la foto, para el panel y el banco de pruebas. */
  async obtener(userId: string, productoId: string): Promise<Buffer> {
    const imagen = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId },
      select: { datos: true },
    });
    if (!imagen) throw new NotFoundException('Ese producto no tiene foto.');
    return Buffer.from(imagen.datos);
  }

  /**
   * La foto para mandar por WhatsApp, o null si el producto no es de la
   * cuenta, está dado de baja o no tiene.
   */
  async paraEnviar(userId: string, productoId: string): Promise<ImagenParaEnviar | null> {
    const imagen = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId, producto: { activo: true } },
      select: { datos: true, producto: { select: { nombre: true } } },
    });
    return imagen ? { datos: Buffer.from(imagen.datos), nombre: imagen.producto.nombre } : null;
  }

  /**
   * Para el asistente, sin leer los bytes: el nombre del producto y si tiene
   * foto, o null si no es un producto activo de la cuenta.
   */
  async estadoDeFoto(userId: string, productoId: string): Promise<EstadoDeFoto | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { nombre: true, imagen: { select: { id: true } } },
    });
    if (!producto) return null;
    return { nombre: producto.nombre, tieneFoto: producto.imagen !== null };
  }

  async uso(userId: string): Promise<UsoDeImagenes> {
    return { usadas: await usadasPor(this.prisma, userId), maximo: MAX_IMAGENES_POR_CUENTA };
  }

  /**
   * Dos subidas a la vez de la misma cuenta se esperan (el `FOR UPDATE` del
   * usuario): si no, las dos contarían 99 y la cuenta quedaría con 101.
   * Reemplazar una foto no suma.
   */
  private async reservarCupo(tx: Tx, userId: string, reemplaza: boolean): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (reemplaza) return;
    if ((await usadasPor(tx, userId)) >= MAX_IMAGENES_POR_CUENTA) {
      throw new ConflictException(
        `Llegaste al máximo de ${MAX_IMAGENES_POR_CUENTA} fotos. Quitale la foto a otro producto para subir esta.`,
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

async function procesar(archivo: Buffer): Promise<ImagenProcesada> {
  try {
    return await procesarImagen(archivo);
  } catch (error) {
    if (error instanceof ImagenInvalidaError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}
