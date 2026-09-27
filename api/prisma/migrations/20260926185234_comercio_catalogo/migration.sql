-- Módulo comercio: catálogo de productos con variantes y el discriminador
-- `Agent.tipoAsistente` ("agenda" | "ventas"). Los agentes existentes quedan
-- en "agenda", incluidos los que tienen el tipoUso retirado "comercio".
--
-- pgvector y pg_trgm son para el RAG del asistente de ventas. La imagen de
-- producción (railwayapp-templates/postgres-ssl:18) ya trae pgvector; en local
-- el compose usa pgvector/pgvector:pg16. pg_trgm viene con el contrib de
-- cualquier Postgres oficial.
--
-- `embedding` no lleva índice HNSW a propósito: el catálogo es por cuenta y un
-- índice aproximado global, filtrado después por userId, devuelve de menos
-- (o nada) para los comercios chicos. La búsqueda vectorial es exacta sobre
-- los productos de una sola cuenta (ver busqueda.service.ts).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "tipoAsistente" TEXT NOT NULL DEFAULT 'agenda';

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "categoria" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "textoBusqueda" TEXT NOT NULL DEFAULT '',
    "busqueda" tsvector,
    "embedding" vector(1536),
    "embeddingHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variante" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "precioCentavos" INTEGER NOT NULL,
    "stock" INTEGER,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "stockMinimo" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Producto_userId_categoria_idx" ON "Producto"("userId", "categoria");

-- CreateIndex
CREATE INDEX "Producto_busqueda_idx" ON "Producto" USING GIN ("busqueda");

-- CreateIndex
CREATE INDEX "Producto_textoBusqueda_idx" ON "Producto" USING GIN ("textoBusqueda" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Producto_userId_codigo_key" ON "Producto"("userId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Variante_productoId_sku_key" ON "Variante"("productoId", "sku");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
