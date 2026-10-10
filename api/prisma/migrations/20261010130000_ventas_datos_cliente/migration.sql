-- Datos que el asistente de ventas le pide al cliente (envío, DNI, email o
-- campos propios del comercio) y lo que el cliente contestó en cada pedido.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "datosCliente" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "haceEnvios" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "datosCliente" JSONB,
ADD COLUMN     "entrega" TEXT;
