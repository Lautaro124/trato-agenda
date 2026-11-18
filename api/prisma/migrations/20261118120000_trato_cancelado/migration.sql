-- Estado del trato que marca el dueño desde el panel de chats.
ALTER TABLE "Conversation" ADD COLUMN "tratoCanceladoAt" TIMESTAMP(3);
