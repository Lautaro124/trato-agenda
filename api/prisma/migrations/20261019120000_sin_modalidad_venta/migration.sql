-- La modalidad de venta deja de ser de la cuenta: cada producto es de stock o
-- a medida (`Producto.solicitud`), y una misma cuenta vende las dos cosas.
-- "Qué hacés" se elimina con ella.

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "modalidadVenta",
DROP COLUMN "queHace";
