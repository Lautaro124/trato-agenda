-- Módulo comercio: pedidos y ventas del asistente de ventas (Venta con sus
-- ItemVenta, que guardan una foto del producto) y la cuenta de Mercado Pago de
-- cada comercio, conectada por OAuth con los tokens cifrados.

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "nombreCliente" TEXT,
    "telefonoCliente" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente_pago',
    "medioPago" TEXT NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "reservaVenceAt" TIMESTAMP(3) NOT NULL,
    "mpPreferenceId" TEXT,
    "linkPago" TEXT,
    "mpPaymentId" TEXT,
    "pagadaAt" TIMESTAMP(3),
    "canceladaAt" TIMESTAMP(3),
    "sinStockAlPagar" BOOLEAN NOT NULL DEFAULT false,
    "dePrueba" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVenta" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "varianteId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombreProducto" TEXT NOT NULL,
    "nombreVariante" TEXT NOT NULL DEFAULT '',
    "precioUnitarioCentavos" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "subtotalCentavos" INTEGER NOT NULL,

    CONSTRAINT "ItemVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaMercadoPago" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mpUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "conectadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaMercadoPago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venta_mpPaymentId_key" ON "Venta"("mpPaymentId");

-- CreateIndex
CREATE INDEX "Venta_userId_createdAt_idx" ON "Venta"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Venta_estado_reservaVenceAt_idx" ON "Venta"("estado", "reservaVenceAt");

-- CreateIndex
CREATE INDEX "Venta_conversationId_idx" ON "Venta"("conversationId");

-- CreateIndex
CREATE INDEX "ItemVenta_varianteId_idx" ON "ItemVenta"("varianteId");

-- CreateIndex
CREATE INDEX "ItemVenta_ventaId_idx" ON "ItemVenta"("ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaMercadoPago_userId_key" ON "CuentaMercadoPago"("userId");

-- CreateIndex
CREATE INDEX "CuentaMercadoPago_mpUserId_idx" ON "CuentaMercadoPago"("mpUserId");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaMercadoPago" ADD CONSTRAINT "CuentaMercadoPago_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
