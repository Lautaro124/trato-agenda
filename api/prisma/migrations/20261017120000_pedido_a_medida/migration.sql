-- Pedidos a medida (LAU-24/26/27/28): una solicitud del cliente es un pedido
-- (Venta tipo "a_medida") que pasa por solicitado → a cotizar → cotizado →
-- pendiente de pago → pagado, sin importe ni reserva hasta que se cotiza.
-- Presupuestos versionados, historial de cambios y atención humana (el
-- asistente se calla en ese chat mientras el dueño lo atiende).
-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "atencion" TEXT NOT NULL DEFAULT 'asistente',
ADD COLUMN     "derivadaAt" TIMESTAMP(3),
ADD COLUMN     "detalleDerivacion" TEXT,
ADD COLUMN     "devueltaAt" TIMESTAMP(3),
ADD COLUMN     "motivoDerivacion" TEXT,
ADD COLUMN     "notaDevolucion" TEXT,
ADD COLUMN     "solicitud" JSONB,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'stock',
ALTER COLUMN "medioPago" DROP NOT NULL,
ALTER COLUMN "totalCentavos" DROP NOT NULL,
ALTER COLUMN "reservaVenceAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Presupuesto" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origen" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "renglones" JSONB NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "estimativo" BOOLEAN NOT NULL DEFAULT false,
    "detalleAlCliente" BOOLEAN NOT NULL DEFAULT false,
    "nota" TEXT,
    "datos" JSONB,
    "enviadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Presupuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoVenta" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "de" TEXT,
    "a" TEXT,
    "motivo" TEXT,
    "autor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Presupuesto_ventaId_version_key" ON "Presupuesto"("ventaId", "version");

-- CreateIndex
CREATE INDEX "EventoVenta_ventaId_createdAt_idx" ON "EventoVenta"("ventaId", "createdAt");

-- CreateIndex
CREATE INDEX "Venta_userId_atencion_idx" ON "Venta"("userId", "atencion");

-- AddForeignKey
ALTER TABLE "Presupuesto" ADD CONSTRAINT "Presupuesto_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoVenta" ADD CONSTRAINT "EventoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

