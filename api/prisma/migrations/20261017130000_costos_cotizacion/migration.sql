-- Materiales y costos de un comercio a pedido (LAU-26): insumos con su costo
-- por unidad, la configuración de cómo cotiza el asistente y la receta de
-- cada producto a medida con quién lo cotiza.
-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "politicaCotizacion" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "receta" JSONB;

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "costoCentavos" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigCotizacion" (
    "userId" TEXT NOT NULL,
    "extras" JSONB NOT NULL DEFAULT '[]',
    "redondeoCentavos" INTEGER NOT NULL DEFAULT 0,
    "estimativo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDias" INTEGER,
    "desgloseAlCliente" TEXT NOT NULL DEFAULT 'total',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigCotizacion_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_userId_tipo_nombre_key" ON "Insumo"("userId", "tipo", "nombre");

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigCotizacion" ADD CONSTRAINT "ConfigCotizacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

