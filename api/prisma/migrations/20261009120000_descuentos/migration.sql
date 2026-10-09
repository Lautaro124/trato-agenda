-- Descuentos del asistente de ventas: el propio de cada producto y las promos
-- de todo el catálogo o de una categoría (comercio/descuentos.rules.ts). Cada
-- renglón de venta guarda el precio de lista y lo descontado como snapshot.

-- AlterTable
ALTER TABLE "ItemVenta" ADD COLUMN     "descuentoCentavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "descuentoEtiqueta" TEXT,
ADD COLUMN     "precioListaCentavos" INTEGER;

-- CreateTable
CREATE TABLE "Descuento" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productoId" TEXT,
    "categoria" TEXT,
    "nombre" TEXT NOT NULL DEFAULT '',
    "tipo" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "desde" TIMESTAMP(3),
    "hasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Descuento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Descuento_productoId_key" ON "Descuento"("productoId");

-- CreateIndex
CREATE INDEX "Descuento_userId_activo_idx" ON "Descuento"("userId", "activo");

-- AddForeignKey
ALTER TABLE "Descuento" ADD CONSTRAINT "Descuento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Descuento" ADD CONSTRAINT "Descuento_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

