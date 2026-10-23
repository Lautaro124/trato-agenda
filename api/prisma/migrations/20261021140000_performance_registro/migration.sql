-- LAU-30: registro del módulo de performance. EtapaChat guarda la etapa más
-- avanzada de cada chat de ventas e InteresProducto qué productos vio o pidió.
-- Sin datos personales; la conversación se desliga a los 12 meses.

-- CreateTable
CREATE TABLE "EtapaChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "etapa" TEXT NOT NULL DEFAULT 'consulta',
    "etapaJev" TEXT,
    "derivado" BOOLEAN NOT NULL DEFAULT false,
    "provincia" TEXT,
    "origenZona" TEXT,
    "clasificadaAt" TIMESTAMP(3),
    "ultimaActividadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtapaChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteresProducto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "productoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteresProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EtapaChat_conversationId_key" ON "EtapaChat"("conversationId");

-- CreateIndex
CREATE INDEX "EtapaChat_userId_ultimaActividadAt_idx" ON "EtapaChat"("userId", "ultimaActividadAt");

-- CreateIndex
CREATE INDEX "InteresProducto_userId_createdAt_idx" ON "InteresProducto"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InteresProducto_productoId_idx" ON "InteresProducto"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "InteresProducto_conversationId_productoId_tipo_key" ON "InteresProducto"("conversationId", "productoId", "tipo");

-- AddForeignKey
ALTER TABLE "EtapaChat" ADD CONSTRAINT "EtapaChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaChat" ADD CONSTRAINT "EtapaChat_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteresProducto" ADD CONSTRAINT "InteresProducto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteresProducto" ADD CONSTRAINT "InteresProducto_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteresProducto" ADD CONSTRAINT "InteresProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
