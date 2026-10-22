-- LAU-30: la lectura de performance filtra los chats por cuenta y fecha de alta.

-- CreateIndex
CREATE INDEX "EtapaChat_userId_createdAt_idx" ON "EtapaChat"("userId", "createdAt");
