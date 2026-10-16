-- Precio "desde" opcional de un producto a medida (cuenta a pedido), que no
-- tiene variantes: el precio real sale de la cotización.
ALTER TABLE "Producto" ADD COLUMN "precioReferenciaCentavos" INTEGER;
