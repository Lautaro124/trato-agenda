-- La foto propia de una variante fija de un producto a medida (cuenta a
-- pedido). Mismo formato que ImagenProducto y cuenta para el mismo cupo.
CREATE TABLE "ImagenVariante" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagenVariante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagenVariante_varianteId_key" ON "ImagenVariante"("varianteId");

-- CreateIndex
CREATE INDEX "ImagenVariante_userId_idx" ON "ImagenVariante"("userId");

-- AddForeignKey
ALTER TABLE "ImagenVariante" ADD CONSTRAINT "ImagenVariante_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagenVariante" ADD CONSTRAINT "ImagenVariante_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
