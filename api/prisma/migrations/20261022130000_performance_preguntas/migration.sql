-- LAU-30: preguntas de los clientes, clasificadas por el modelo cuando el chat
-- se estanca o paga. Sin datos personales; el texto (saneado) se borra a los 90 días.

-- CreateTable
CREATE TABLE "PreguntaChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "etapaChatId" TEXT NOT NULL,
    "texto" TEXT,
    "tema" TEXT NOT NULL,
    "productoId" TEXT,
    "resuelta" BOOLEAN NOT NULL,
    "etapa" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreguntaChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreguntaChat_userId_createdAt_idx" ON "PreguntaChat"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PreguntaChat_etapaChatId_idx" ON "PreguntaChat"("etapaChatId");

-- AddForeignKey
ALTER TABLE "PreguntaChat" ADD CONSTRAINT "PreguntaChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreguntaChat" ADD CONSTRAINT "PreguntaChat_etapaChatId_fkey" FOREIGN KEY ("etapaChatId") REFERENCES "EtapaChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreguntaChat" ADD CONSTRAINT "PreguntaChat_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
