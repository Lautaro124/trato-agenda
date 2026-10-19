import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImagenInvalidaError, MAX_IMAGENES_POR_CUENTA, procesarImagen, type ImagenProcesada } from './imagenes.rules.js';

export type ImagenGuardada = { bytes: number; ancho: number; alto: number };

export type UsoDeImagenes = { usadas: number; maximo: number };

/** La foto que el asistente le manda a un cliente: sólo la de un producto activo de la cuenta. */
export type ImagenParaEnviar = { datos: Buffer; nombre: string };

/**
 * Lo que sabe el asistente de la foto que quiere mandar, sin los bytes. Con
 * una variante que tiene foto propia va esa (`deVariante`); si no, la del
 * producto.
 */
export type EstadoDeFoto = { nombre: string; tieneFoto: boolean; deVariante?: boolean };

type Tx = Prisma.TransactionClient;

/**
 * Fotos de productos: una por producto (y una por variante fija de un
 * producto a medida) y hasta `MAX_IMAGENES_POR_CUENTA` entre todas por cuenta
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

  /** La foto propia de una variante fija: la que va cuando el cliente elige esa versión. */
  async guardarDeVariante(userId: string, productoId: string, varianteId: string, archivo: Buffer): Promise<ImagenGuardada> {
    await this.variantePropia(userId, productoId, varianteId);
    const imagen = await procesar(archivo);

    await this.prisma.$transaction(async (tx) => {
      const yaTiene = await tx.imagenVariante.findUnique({ where: { varianteId }, select: { id: true } });
      await this.reservarCupo(tx, userId, yaTiene !== null);
      const fila = { datos: new Uint8Array(imagen.datos), bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
      await tx.imagenVariante.upsert({
        where: { varianteId },
        create: { userId, varianteId, ...fila },
        update: fila,
      });
    });
    return { bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto };
  }

  async borrar(userId: string, productoId: string): Promise<void> {
    await this.prisma.imagenProducto.deleteMany({ where: { userId, productoId } });
  }

  async borrarDeVariante(userId: string, productoId: string, varianteId: string): Promise<void> {
    await this.prisma.imagenVariante.deleteMany({ where: { userId, varianteId, variante: { productoId } } });
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

  async obtenerDeVariante(userId: string, productoId: string, varianteId: string): Promise<Buffer> {
    const imagen = await this.prisma.imagenVariante.findFirst({
      where: { userId, varianteId, variante: { productoId } },
      select: { datos: true },
    });
    if (!imagen) throw new NotFoundException('Esa versión no tiene foto.');
    return Buffer.from(imagen.datos);
  }

  /**
   * La foto para mandar por WhatsApp, o null si el producto no es de la
   * cuenta, está dado de baja o no tiene. Con `varianteId`, la de esa variante
   * activa del producto (el nombre va con el de la versión).
   */
  async paraEnviar(userId: string, productoId: string, varianteId?: string): Promise<ImagenParaEnviar | null> {
    if (varianteId) {
      const deVariante = await this.prisma.imagenVariante.findFirst({
        where: { userId, varianteId, variante: { activo: true, productoId, producto: { activo: true } } },
        select: { datos: true, variante: { select: { nombre: true, producto: { select: { nombre: true } } } } },
      });
      return deVariante
        ? {
            datos: Buffer.from(deVariante.datos),
            nombre: `${deVariante.variante.producto.nombre} · ${deVariante.variante.nombre}`,
          }
        : null;
    }
    const imagen = await this.prisma.imagenProducto.findFirst({
      where: { userId, productoId, producto: { activo: true } },
      select: { datos: true, producto: { select: { nombre: true } } },
    });
    return imagen ? { datos: Buffer.from(imagen.datos), nombre: imagen.producto.nombre } : null;
  }

  /**
   * Para el asistente, sin leer los bytes: el nombre del producto y si tiene
   * foto, o null si no es un producto activo de la cuenta (o la variante no es
   * una activa de ese producto). Una variante sin foto propia usa la del
   * producto.
   */
  async estadoDeFoto(userId: string, productoId: string, varianteId?: string): Promise<EstadoDeFoto | null> {
    const [producto, variante] = await Promise.all([
      this.prisma.producto.findFirst({
        where: { id: productoId, userId, activo: true },
        select: { nombre: true, imagen: { select: { id: true } } },
      }),
      varianteId
        ? this.prisma.variante.findFirst({
            where: { id: varianteId, productoId, activo: true },
            select: { nombre: true, imagen: { select: { id: true } } },
          })
        : null,
    ]);
    if (!producto || (varianteId && !variante)) return null;
    if (variante?.imagen) return { nombre: `${producto.nombre} · ${variante.nombre}`, tieneFoto: true, deVariante: true };
    return { nombre: producto.nombre, tieneFoto: producto.imagen !== null, deVariante: false };
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

  private async variantePropia(userId: string, productoId: string, varianteId: string): Promise<void> {
    const variante = await this.prisma.variante.findFirst({
      where: { id: varianteId, productoId, activo: true, producto: { userId, activo: true } },
      select: { id: true },
    });
    if (!variante) throw new NotFoundException('No existe esa versión del producto.');
  }

  private async productoPropio(userId: string, productoId: string): Promise<void> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('No existe ese producto.');
  }
}

/** Las fotos que ocupan cupo: las de productos y las de variantes. */
async function usadasPor(prisma: Pick<Tx, 'imagenProducto' | 'imagenVariante'>, userId: string): Promise<number> {
  const [productos, variantes] = await Promise.all([
    prisma.imagenProducto.count({ where: { userId } }),
    prisma.imagenVariante.count({ where: { userId } }),
  ]);
  return productos + variantes;
}

async function procesar(archivo: Buffer): Promise<ImagenProcesada> {
  try {
    return await procesarImagen(archivo);
  } catch (error) {
    if (error instanceof ImagenInvalidaError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}
