-- El número de los chats con identificador LID ("…@lid"), que no lo traen en
-- el JID: sin él, Inicio los mostraba como "Cliente sin número".

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "telefono" TEXT;
