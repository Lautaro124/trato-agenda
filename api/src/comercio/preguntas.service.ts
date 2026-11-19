import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImagenInvalidaError, MAX_IMAGENES_POR_MENSAJE, procesarImagen, type ImagenProcesada } from './imagenes.rules.js';
import {
  imagenesDePregunta,
  imagenesUsadas,
  leerPreguntas,
  normalizarPreguntas,
  productosUsados,
  type ImagenDePregunta,
  type PreguntaPedido,
} from './preguntas-pedido.rules.js';

/** Tope de imágenes de preguntas y opciones por cuenta (aparte de las fotos de productos). */
export const MAX_IMAGENES_PREGUNTAS = 120;

/**
 * Una imagen subida y todavía sin guardar en la configuración se conserva un
 * día: alcanza para terminar de editar y no deja basura para siempre.
 */
const GRACIA_IMAGEN_SIN_USO_MS = 24 * 60 * 60 * 1000;

export type ImagenesParaEnviar = { imagenes: ImagenDePregunta[] } | { error: string };

/**
 * Las preguntas del pedido de la cuenta (LAU-100) y sus imágenes. Todo
 * scopeado al usuario: los productos y las imágenes que nombra una pregunta
 * tienen que ser suyos.
 */
@Injectable()
export class PreguntasService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(userId: string): Promise<PreguntaPedido[]> {
    const fila = await this.prisma.configuracionPreguntas.findUnique({ where: { userId }, select: { preguntas: true } });
    return leerPreguntas(fila?.preguntas);
  }

  /**
   * Reemplaza todas las preguntas. Valida la forma (normalizarPreguntas), que
   * los productos sean del catálogo de la cuenta y que las imágenes sean
   * suyas; después borra las imágenes que ya no usa ninguna pregunta.
   */
  async guardar(userId: string, entrada: unknown, ahora: Date = new Date()): Promise<PreguntaPedido[]> {
    const resultado = normalizarPreguntas(entrada);
    if ('error' in resultado) throw new UnprocessableEntityException(resultado.error);
    const { preguntas } = resultado;

    const productos = productosUsados(preguntas);
    if (productos.length > 0) {
      const propios = await this.prisma.producto.count({ where: { userId, activo: true, id: { in: productos } } });
      if (propios !== productos.length) {
        throw new UnprocessableEntityException('Alguno de los productos elegidos ya no está en el catálogo. Revisá las preguntas.');
      }
    }
    const imagenes = imagenesUsadas(preguntas);
    if (imagenes.length > 0) {
      const propias = await this.prisma.imagenPregunta.count({ where: { userId, id: { in: imagenes } } });
      if (propias !== imagenes.length) {
        throw new UnprocessableEntityException('Alguna imagen ya no está. Volvé a subirla.');
      }
    }

    await this.prisma.$transaction([
      this.prisma.configuracionPreguntas.upsert({
        where: { userId },
        create: { userId, preguntas: preguntas as unknown as Prisma.InputJsonValue },
        update: { preguntas: preguntas as unknown as Prisma.InputJsonValue },
      }),
      this.prisma.imagenPregunta.deleteMany({
        where: { userId, id: { notIn: imagenes }, createdAt: { lt: new Date(ahora.getTime() - GRACIA_IMAGEN_SIN_USO_MS) } },
      }),
    ]);
    return preguntas;
  }

  /** Sube una imagen para una pregunta u opción; queda sin usar hasta que se guarden las preguntas. */
  async subirImagen(userId: string, archivo: Buffer, ahora: Date = new Date()): Promise<{ id: string }> {
    const imagen = await procesar(archivo);
    return this.prisma.$transaction(async (tx) => {
      // Dos subidas a la vez de la misma cuenta no pasan juntas el tope.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const config = await tx.configuracionPreguntas.findUnique({ where: { userId }, select: { preguntas: true } });
      const usadas = imagenesUsadas(leerPreguntas(config?.preguntas));
      // Las que no usa nadie y ya pasaron la gracia no cuentan: se borran acá mismo.
      await tx.imagenPregunta.deleteMany({
        where: { userId, id: { notIn: usadas }, createdAt: { lt: new Date(ahora.getTime() - GRACIA_IMAGEN_SIN_USO_MS) } },
      });
      if ((await tx.imagenPregunta.count({ where: { userId } })) >= MAX_IMAGENES_PREGUNTAS) {
        throw new ConflictException(`Llegaste al máximo de ${MAX_IMAGENES_PREGUNTAS} imágenes de preguntas. Quitá alguna para subir esta.`);
      }
      const creada = await tx.imagenPregunta.create({
        data: { userId, datos: new Uint8Array(imagen.datos), bytes: imagen.bytes, ancho: imagen.ancho, alto: imagen.alto },
        select: { id: true },
      });
      return creada;
    });
  }

  async imagen(userId: string, imagenId: string): Promise<Buffer> {
    const imagen = await this.prisma.imagenPregunta.findFirst({ where: { id: imagenId, userId }, select: { datos: true } });
    if (!imagen) throw new NotFoundException('No existe esa imagen.');
    return Buffer.from(imagen.datos);
  }

  /** Para WhatsApp: los bytes, o null si no es de la cuenta. */
  async paraEnviar(userId: string, imagenId: string): Promise<Buffer | null> {
    const imagen = await this.prisma.imagenPregunta.findFirst({ where: { id: imagenId, userId }, select: { datos: true } });
    return imagen ? Buffer.from(imagen.datos) : null;
  }

  /**
   * Para el asistente: las imágenes de una pregunta en la rama que eligió el
   * cliente (`segun`), sin leer los bytes. Hasta MAX_IMAGENES_POR_MENSAJE.
   */
  async imagenesParaEnviar(userId: string, preguntaId: string, segun?: string): Promise<ImagenesParaEnviar> {
    const preguntas = await this.obtener(userId);
    const pregunta = preguntas.find((candidata) => candidata.id === preguntaId);
    if (!pregunta) return { error: `No existe la pregunta [pregunta ${preguntaId}]. Usá los ids de las preguntas que tenés.` };
    const resultado = imagenesDePregunta(pregunta, preguntas, segun);
    if ('error' in resultado) return resultado;
    return { imagenes: resultado.imagenes.slice(0, MAX_IMAGENES_POR_MENSAJE) };
  }
}

async function procesar(archivo: Buffer): Promise<ImagenProcesada> {
  try {
    return await procesarImagen(archivo);
  } catch (error) {
    if (error instanceof ImagenInvalidaError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}
