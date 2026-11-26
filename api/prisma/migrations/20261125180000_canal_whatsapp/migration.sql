-- Cómo atiende WhatsApp cada comercio (LAU-110): proveedor, pausa de las
-- respuestas automáticas y generación. Sin fila = Baileys sin pausa, así que
-- las cuentas existentes no necesitan datos nuevos.
-- CreateTable
CREATE TABLE "CanalWhatsapp" (
    "userId" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL DEFAULT 'baileys',
    "automatizacionPausada" BOOLEAN NOT NULL DEFAULT false,
    "generacion" INTEGER NOT NULL DEFAULT 0,
    "ultimoFallo" TEXT,
    "ultimoFalloAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanalWhatsapp_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "CanalWhatsapp" ADD CONSTRAINT "CanalWhatsapp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

