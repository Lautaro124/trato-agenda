-- LAU-37: último aviso de "vendedor no disponible" a un chat ya iniciado,
-- para mandarlo una sola vez por cierre del horario de atención.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "avisoFueraDeHorarioAt" TIMESTAMP(3);
