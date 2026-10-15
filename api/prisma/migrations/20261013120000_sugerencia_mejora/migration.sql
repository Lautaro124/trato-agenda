-- Sugerencias de mejora (LAU-14): se guardan siempre y después se copian a
-- Linear; las que Linear no aceptó quedan con "enviadaAt" null para reintentar.

-- CreateTable
CREATE TABLE "SugerenciaMejora" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "linearIssueId" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "enviadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SugerenciaMejora_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SugerenciaMejora_userId_createdAt_idx" ON "SugerenciaMejora"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SugerenciaMejora_enviadaAt_idx" ON "SugerenciaMejora"("enviadaAt");

-- AddForeignKey
ALTER TABLE "SugerenciaMejora" ADD CONSTRAINT "SugerenciaMejora_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
