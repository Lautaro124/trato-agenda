-- LAU-81: quién contesta pasa a ser un estado de la conversación.
ALTER TABLE "Conversation" ADD COLUMN     "atencion" TEXT NOT NULL DEFAULT 'asistente',
ADD COLUMN     "devueltaAt" TIMESTAMP(3),
ADD COLUMN     "notaDevolucion" TEXT,
ADD COLUMN     "tomadaAt" TIMESTAMP(3);

-- Mensajes mandados desde el panel: llave de idempotencia.
ALTER TABLE "Message" ADD COLUMN     "clave" TEXT;

CREATE UNIQUE INDEX "Message_conversationId_clave_key" ON "Message"("conversationId", "clave");

-- Los chats que hoy calla un pedido abierto en atención humana (LAU-27)
-- quedan en "humana" a nivel conversación, desde su última derivación.
UPDATE "Conversation" c
SET "atencion" = 'humana', "tomadaAt" = v."derivadaAt"
FROM (
  SELECT "conversationId", MAX(COALESCE("derivadaAt", "updatedAt")) AS "derivadaAt"
  FROM "Venta"
  WHERE "atencion" = 'humana'
    AND "conversationId" IS NOT NULL
    AND "estado" IN ('solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida')
  GROUP BY "conversationId"
) v
WHERE c."id" = v."conversationId";

-- Último mensaje de cada chat, para ordenar la lista de Chats. Lo mantiene un
-- trigger: los mensajes se guardan desde varios lugares (grafos, WhatsApp, panel).
ALTER TABLE "Conversation" ADD COLUMN "ultimoMensajeAt" TIMESTAMP(3);

CREATE INDEX "Conversation_userId_ultimoMensajeAt_idx" ON "Conversation"("userId", "ultimoMensajeAt");

UPDATE "Conversation" c
SET "ultimoMensajeAt" = m."ultimo"
FROM (SELECT "conversationId", MAX("createdAt") AS "ultimo" FROM "Message" GROUP BY "conversationId") m
WHERE c."id" = m."conversationId";

CREATE OR REPLACE FUNCTION "trato_marcar_ultimo_mensaje"() RETURNS trigger AS $$
BEGIN
  UPDATE "Conversation"
  SET "ultimoMensajeAt" = GREATEST(COALESCE("ultimoMensajeAt", NEW."createdAt"), NEW."createdAt")
  WHERE "id" = NEW."conversationId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Message_marcar_ultimo_mensaje"
AFTER INSERT ON "Message"
FOR EACH ROW EXECUTE FUNCTION "trato_marcar_ultimo_mensaje"();
