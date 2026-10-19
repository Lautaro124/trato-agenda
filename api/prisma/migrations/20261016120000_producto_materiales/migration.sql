-- Materiales con los que se hace un producto a medida (cuenta a pedido): el
-- asistente ofrece sólo esos. Vacío = no los cargó.
ALTER TABLE "Producto" ADD COLUMN "materiales" TEXT[] DEFAULT ARRAY[]::TEXT[];
