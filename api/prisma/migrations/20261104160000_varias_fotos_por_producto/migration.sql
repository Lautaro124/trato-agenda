-- Hasta 4 fotos por producto (comercio/imagenes.rules.ts): la de `orden` 0 es
-- la principal y el resto, las de detalle. La foto que ya tenía cada producto
-- queda como su principal (orden 0 por defecto).

-- DropIndex
DROP INDEX "ImagenProducto_productoId_key";

-- AlterTable
ALTER TABLE "ImagenProducto" ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ImagenProducto_productoId_orden_idx" ON "ImagenProducto"("productoId", "orden");
