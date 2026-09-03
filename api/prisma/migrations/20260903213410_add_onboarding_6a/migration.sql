-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "horaDesde" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "horaHasta" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "nombreBot" TEXT NOT NULL DEFAULT 'Tati',
ADD COLUMN     "nombreTitular" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tipoTitular" TEXT NOT NULL DEFAULT 'negocio',
ADD COLUMN     "tiposEvento" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "nombreCliente" TEXT;

-- AlterTable
ALTER TABLE "Turno" ADD COLUMN     "nombreCliente" TEXT;
