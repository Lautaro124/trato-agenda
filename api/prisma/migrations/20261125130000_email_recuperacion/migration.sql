-- LAU-109: email de recuperación verificado, independiente de WhatsApp.
-- Sólo agrega columnas nulas y una tabla nueva: ninguna cuenta existente cambia.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailRecuperacion" TEXT,
ADD COLUMN "emailVerificadoAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VerificacionEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificacionEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailRecuperacion_key" ON "User"("emailRecuperacion");

-- CreateIndex
CREATE UNIQUE INDEX "VerificacionEmail_userId_key" ON "VerificacionEmail"("userId");

-- AddForeignKey
ALTER TABLE "VerificacionEmail" ADD CONSTRAINT "VerificacionEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
