-- Mensajes personalizados del asistente (saludo, link de pago, sin productos,
-- pago recibido, horario ocupado). Vacío = todos en automático.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "mensajes" JSONB NOT NULL DEFAULT '{}';
