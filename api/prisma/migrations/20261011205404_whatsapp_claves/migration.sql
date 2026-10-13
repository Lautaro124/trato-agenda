-- Claves de Signal de WhatsApp, una por fila (LAU-18). Antes iban todas en el
-- blob cifrado de WhatsappSession.authState, que se reescribía entero en cada
-- mensaje. Las sesiones existentes se parten en filas al cargarlas por primera
-- vez (whatsapp-auth-state.ts): no hace falta volver a vincular.

-- CreateTable
CREATE TABLE "WhatsappClave" (
    "userId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappClave_pkey" PRIMARY KEY ("userId","categoria","clave")
);

-- AddForeignKey
ALTER TABLE "WhatsappClave" ADD CONSTRAINT "WhatsappClave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WhatsappSession"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
