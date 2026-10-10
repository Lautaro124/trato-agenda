import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImagenInvalidaError, MAX_IMAGENES_POR_CUENTA, procesarImagen, type ImagenProcesada } from './imagenes.rules.js';

export type ImagenGuardada = { bytes: number; ancho: number; alto: number };

export type UsoDeImagenes = { usadas: number; maximo: number };

/** La foto que el asistente le manda a un cliente: sólo la de un producto activo de la cuenta. */
export type ImagenParaEnviar = { datos: Buffer; nombre: string };

/**
 * Fotos de productos: una por producto y hasta `MAX_IMAGENES_POR_CUENTA` por
 * cuenta (imagenes.rules.ts). Todo va scopeado al dueño; ninguna lectura de
 * listado trae los bytes, sólo `obtener` y `paraEnviar`.
 */
@Injectable()
export class ImagenesService {
  constructor(private readonly prisma: PrismaService) {}

  async guardar(userId: string, productoId: string, archivo: Buffer): Promise<ImagenGuardada> {
    await this.productoPropio(userId, productoId);

    let imagen: ImagenProcesada;
    try {
      imagen = await procesarImagen(archivo);
    } catch (error) {
      if (error instanceof ImagenInvalidaError) throw new UnprocessableEntityException(error.message);
      throw error;
    }

    await this.prisma.$transaction(async (tx) => {
      // Dos subidas a la vez de la misma cuenta se esperan: si no, las dos
      // contarían 99 y la cuenta quedaría con 101.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const yaTiene = await tx.imagenProducto.findUnique({ where: { productoId }, select: { id: true } });
      if (!yaTiene) {
        const usadas = await tx.imagenProducto.count({ where: { userId } });
        if (usadas >= MAX_IMAGENES_POR_CUENTA) {
          throw new ConflictException(
            `Llegaste al máximo de ${MAX_IMAGENES_POR_CUENTA} productos con foto. Quitale la foto a otro para subir esta.`,
          );
        }
      }
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

  /** La foto para mandar por WhatsApp, o null si el producto no es de la cuenta, está dado de baja o no tiene. */
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
  async estadoDeFoto(userId: string, productoId: string): Promise<{ nombre: string; tieneFoto: boolean } | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { nombre: true, imagen: { select: { id: true } } },
    });
    return producto ? { nombre: producto.nombre, tieneFoto: producto.imagen !== null } : null;
  }

  async uso(userId: string): Promise<UsoDeImagenes> {
    return { usadas: await this.prisma.imagenProducto.count({ where: { userId } }), maximo: MAX_IMAGENES_POR_CUENTA };
  }

  private async productoPropio(userId: string, productoId: string): Promise<void> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('No existe ese producto.');
  }
}
