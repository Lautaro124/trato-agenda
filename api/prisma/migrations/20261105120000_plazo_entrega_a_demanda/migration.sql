-- Productos a demanda: plazo de entrega en días (null con stock controlado).
ALTER TABLE "Producto" ADD COLUMN "plazoEntregaDias" INTEGER;
