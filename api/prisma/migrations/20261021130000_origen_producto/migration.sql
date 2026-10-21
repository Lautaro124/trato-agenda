-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "importadoAt" TIMESTAMP(3),
ADD COLUMN     "origenId" TEXT,
ADD COLUMN     "origenUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Producto_userId_origenId_key" ON "Producto"("userId", "origenId");

