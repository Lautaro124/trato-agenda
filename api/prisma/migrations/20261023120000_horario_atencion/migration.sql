-- LAU-29: horario de atención del asistente por cuenta. Las cuentas existentes
-- quedan sin restricción (atienden siempre, como antes).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "horarioAtencionActivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "horarioAtencion" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
