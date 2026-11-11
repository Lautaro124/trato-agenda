-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "anuncioAt" TIMESTAMP(3),
ADD COLUMN     "anuncioId" TEXT;

-- CreateTable
CREATE TABLE "Anuncio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceUrl" TEXT,
    "titulo" TEXT,
    "cuerpo" TEXT,
    "miniatura" BYTEA,
    "descripcionMiniatura" TEXT,
    "productoId" TEXT,
    "asociacion" TEXT NOT NULL DEFAULT 'pendiente',
    "chats" INTEGER NOT NULL DEFAULT 0,
    "ultimoChatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Anuncio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Anuncio_userId_ultimoChatAt_idx" ON "Anuncio"("userId", "ultimoChatAt");

-- CreateIndex
CREATE UNIQUE INDEX "Anuncio_userId_sourceId_key" ON "Anuncio"("userId", "sourceId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_anuncioId_fkey" FOREIGN KEY ("anuncioId") REFERENCES "Anuncio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

