import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingsClient, literalVector, MAX_TEXTOS_POR_PEDIDO } from './embeddings.client.js';
import { hashTexto } from './catalogo.rules.js';

/** Barrido de respaldo: lo que falló (OpenRouter caído, reinicio a mitad de camino). */
const CADA_MS = 10 * 60 * 1000;

/**
 * Tope de lotes por pasada, para que una importación enorme no tenga ocupado
 * al indexador (ni a OpenRouter) sin cortes. Lo que quede, lo sigue la
 * próxima pasada.
 */
const MAX_LOTES_POR_PASADA = 60;

/**
 * Mantiene al día `Producto.embedding`. Un producto está desactualizado
 * cuando su `embeddingHash` no es el md5 de su `textoBusqueda`, así que la
 * condición se resuelve en SQL y sobrevive a reinicios sin cola aparte.
 *
 * Es un `setInterval` y no `@nestjs/schedule`, igual que RetentionService, y
 * vale la misma aclaración: alcanza porque la API corre en una sola réplica.
 * Una sola pasada a la vez; `programar` durante una pasada deja otra
 * pendiente en vez de encimarlas.
 */
@Injectable()
export class IndexadorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexadorService.name);
  private timer?: NodeJS.Timeout;
  private corriendo: Promise<unknown> | null = null;
  private otraPasada = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  onModuleInit(): void {
    this.programar();
    this.timer = setInterval(() => this.programar(), CADA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pide una pasada sin esperarla. Seguro de llamar muchas veces seguidas. */
  programar(): void {
    if (this.corriendo) {
      this.otraPasada = true;
      return;
    }
    this.corriendo = this.pasada().finally(() => {
      this.corriendo = null;
      if (this.otraPasada) {
        this.otraPasada = false;
        this.programar();
      }
    });
  }

  /** Para los tests: espera a que termine lo que esté corriendo. */
  async esperar(): Promise<void> {
    while (this.corriendo) await this.corriendo;
  }

  /** Una pasada: lotes de productos desactualizados hasta que no quede ninguno. */
  async pasada(): Promise<number> {
    if (!this.embeddings.configurado) return 0;
    let total = 0;
    try {
      for (let lote = 0; lote < MAX_LOTES_POR_PASADA; lote++) {
        const indexados = await this.indexarLote();
        total += indexados;
        if (indexados < MAX_TEXTOS_POR_PEDIDO) break;
      }
    } catch (error) {
      // El barrido siguiente reintenta: el texto sigue marcado como desactualizado.
      this.logger.warn(`No se pudieron calcular embeddings del catálogo: ${(error as Error).message}`);
    }
    if (total > 0) this.logger.log(`Embeddings calculados para ${total} producto${total === 1 ? '' : 's'} del catálogo.`);
    return total;
  }

  private async indexarLote(): Promise<number> {
    const pendientes = await this.prisma.$queryRaw<Array<{ id: string; textoBusqueda: string }>>`
      SELECT "id", "textoBusqueda" FROM "Producto"
      WHERE "activo" AND "textoBusqueda" <> ''
        AND "embeddingHash" IS DISTINCT FROM md5("textoBusqueda")
      ORDER BY "updatedAt" ASC
      LIMIT ${MAX_TEXTOS_POR_PEDIDO}
    `;
    if (pendientes.length === 0) return 0;

    const vectores = await this.embeddings.embeber(pendientes.map((producto) => producto.textoBusqueda));
    for (const [indice, producto] of pendientes.entries()) {
      const hash = hashTexto(producto.textoBusqueda);
      // La condición sobre el hash evita pisar con un vector viejo un producto
      // que se editó mientras OpenRouter respondía.
      await this.prisma.$executeRaw`
        UPDATE "Producto"
        SET "embedding" = ${literalVector(vectores[indice])}::vector, "embeddingHash" = ${hash}
        WHERE "id" = ${producto.id} AND md5("textoBusqueda") = ${hash}
      `;
    }
    return pendientes.length;
  }
}
