-- Modalidad de venta del asistente de ventas (LAU-21): con stock (lo de
-- siempre) o a pedido, y qué hace el comercio cuando vende a pedido.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "modalidadVenta" TEXT NOT NULL DEFAULT 'stock',
ADD COLUMN     "queHace" TEXT;
