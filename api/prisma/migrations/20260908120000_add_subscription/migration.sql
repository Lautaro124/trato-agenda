-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "mpPreapprovalId" TEXT,
    "mpStatus" TEXT,
    "montoCentavos" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "ultimoPagoAt" TIMESTAMP(3),
    "proximoCobroAt" TIMESTAMP(3),
    "canceladaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_mpPreapprovalId_key" ON "Subscription"("mpPreapprovalId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
