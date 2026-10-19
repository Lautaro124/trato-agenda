-- Dos planes de suscripción: Básico (2.500 chats/mes) y Pro (6.000). Las filas existentes pagaron el Básico.
ALTER TABLE "Subscription" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'basico';

-- Cambio de plan en curso (preapproval nuevo todavía sin autorizar).
ALTER TABLE "Subscription" ADD COLUMN "mpPreapprovalPendienteId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "planPendiente" TEXT;
CREATE UNIQUE INDEX "Subscription_mpPreapprovalPendienteId_key" ON "Subscription"("mpPreapprovalPendienteId");

-- Conteo de chats del mes: mensajes por conversación y fecha.
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
