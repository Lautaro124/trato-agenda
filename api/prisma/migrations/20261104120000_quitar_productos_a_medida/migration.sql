-- Los productos a medida y la pantalla de costos dejan de existir. Antes de
-- borrar las columnas y tablas, se resuelven los datos que dependían de ellas.

-- Los productos a medida quedan dados de baja (como un producto borrado: sus
-- ventas guardan su snapshot) y sin foto, para que no ocupe cupo.
DELETE FROM "ImagenProducto" i USING "Producto" p
WHERE i."productoId" = p."id" AND p."solicitud" IS NOT NULL;
UPDATE "Producto" SET "activo" = false WHERE "solicitud" IS NOT NULL;

-- Los pedidos a medida desaparecen (renglones, presupuestos e historial caen
-- en cascada), y con ellos los avisos que sólo existían para cotizarlos.
DELETE FROM "Venta" WHERE "tipo" = 'a_medida';
DELETE FROM "Notificacion"
WHERE "tipo" IN ('solicitud_a_cotizar', 'presupuesto_a_revisar', 'presupuesto_aceptado', 'pedido_derivado');

-- La etapa "cotizado" del embudo era sólo de los pedidos a medida.
UPDATE "EtapaChat" SET "etapa" = 'pedido' WHERE "etapa" = 'cotizado';

-- Las herramientas del asistente que eran sólo de los productos a medida.
UPDATE "Agent"
SET "allowedActions" = array(
  SELECT accion FROM unnest("allowedActions") AS accion
  WHERE accion NOT IN ('registrar_solicitud', 'pedir_variante', 'aceptar_presupuesto', 'derivar_a_persona')
)
WHERE "allowedActions" && ARRAY['registrar_solicitud', 'pedir_variante', 'aceptar_presupuesto', 'derivar_a_persona'];

-- DropForeignKey
ALTER TABLE "ImagenVariante" DROP CONSTRAINT "ImagenVariante_userId_fkey";

-- DropForeignKey
ALTER TABLE "ImagenVariante" DROP CONSTRAINT "ImagenVariante_varianteId_fkey";

-- DropForeignKey
ALTER TABLE "Presupuesto" DROP CONSTRAINT "Presupuesto_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "Insumo" DROP CONSTRAINT "Insumo_userId_fkey";

-- DropForeignKey
ALTER TABLE "ConfigCotizacion" DROP CONSTRAINT "ConfigCotizacion_userId_fkey";

-- AlterTable
ALTER TABLE "Producto" DROP COLUMN "materiales",
DROP COLUMN "politicaCotizacion",
DROP COLUMN "precioReferenciaCentavos",
DROP COLUMN "receta",
DROP COLUMN "solicitud";

-- AlterTable
ALTER TABLE "Venta" DROP COLUMN "solicitud",
DROP COLUMN "tipo";

-- DropTable
DROP TABLE "ImagenVariante";

-- DropTable
DROP TABLE "Presupuesto";

-- DropTable
DROP TABLE "Insumo";

-- DropTable
DROP TABLE "ConfigCotizacion";
