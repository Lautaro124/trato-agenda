-- Local a la calle del asistente de ventas (dirección, horarios por día,
-- enlace de ubicación y si se puede retirar). Null = nunca lo cargó.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "local" JSONB;
