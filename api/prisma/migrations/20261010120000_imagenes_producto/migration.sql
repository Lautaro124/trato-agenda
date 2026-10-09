-- Fotos de productos del asistente de ventas: una por producto, ya
-- recomprimida (JPEG ≤ 800 px, ≤ 150 KB, sin metadatos) y con tope por cuenta
-- en código (comercio/imagenes.rules.ts). Tabla aparte para que los listados
-- no lean los bytes.

-- CreateTable
CREATE TABLE "ImagenProducto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagenProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagenProducto_productoId_key" ON "ImagenProducto"("productoId");

-- CreateIndex
CREATE INDEX "ImagenProducto_userId_idx" ON "ImagenProducto"("userId");

-- AddForeignKey
ALTER TABLE "ImagenProducto" ADD CONSTRAINT "ImagenProducto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagenProducto" ADD CONSTRAINT "ImagenProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

