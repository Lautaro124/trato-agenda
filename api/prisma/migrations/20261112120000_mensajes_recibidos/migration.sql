-- Mensajes de clientes ya atendidos, por id de WhatsApp: una reentrega no se contesta dos veces.
-- CreateTable
CREATE TABLE "MensajeRecibido" (
    "userId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensajeRecibido_pkey" PRIMARY KEY ("userId","waId")
);

-- CreateIndex
CREATE INDEX "MensajeRecibido_createdAt_idx" ON "MensajeRecibido"("createdAt");

-- AddForeignKey
ALTER TABLE "MensajeRecibido" ADD CONSTRAINT "MensajeRecibido_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
