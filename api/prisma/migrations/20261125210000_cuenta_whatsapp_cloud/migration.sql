-- El número de un comercio conectado por la API oficial de WhatsApp (Cloud
-- API con Embedded Signup). Aditiva: las cuentas existentes siguen en Baileys.
-- CreateTable
CREATE TABLE "CuentaWhatsappCloud" (
    "userId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "tokenCifrado" TEXT NOT NULL,
    "coexistencia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaWhatsappCloud_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CuentaWhatsappCloud_phoneNumberId_key" ON "CuentaWhatsappCloud"("phoneNumberId");

-- AddForeignKey
ALTER TABLE "CuentaWhatsappCloud" ADD CONSTRAINT "CuentaWhatsappCloud_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
