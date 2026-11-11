-- Anuncios cargados por el dueño (LAU-103): sin sourceId hasta el primer chat y sin chats todavía.
ALTER TABLE "Anuncio" ADD COLUMN "urlClave" TEXT,
ALTER COLUMN "sourceId" DROP NOT NULL,
ALTER COLUMN "ultimoChatAt" DROP NOT NULL,
ALTER COLUMN "ultimoChatAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Anuncio_userId_urlClave_key" ON "Anuncio"("userId", "urlClave");
