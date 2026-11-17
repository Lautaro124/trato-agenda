-- WhatsApp Business por la Cloud API de Meta: un número conectado por Embedded Signup, excluyente con Baileys.
-- CreateTable
CREATE TABLE "WhatsappMeta" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "coexistencia" BOOLEAN NOT NULL DEFAULT false,
    "conectadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMeta_userId_key" ON "WhatsappMeta"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMeta_phoneNumberId_key" ON "WhatsappMeta"("phoneNumberId");

-- AddForeignKey
ALTER TABLE "WhatsappMeta" ADD CONSTRAINT "WhatsappMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

