-- LAU-34: cuotas con recargo y descuento por pago en efectivo.

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "cuotas" INTEGER,
ADD COLUMN     "formaPago" TEXT,
ADD COLUMN     "recargoCentavos" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CondicionesPago" (
    "userId" TEXT NOT NULL,
    "planesCuotas" JSONB NOT NULL DEFAULT '[]',
    "descuentoEfectivoPorcentaje" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CondicionesPago_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "CondicionesPago" ADD CONSTRAINT "CondicionesPago_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
