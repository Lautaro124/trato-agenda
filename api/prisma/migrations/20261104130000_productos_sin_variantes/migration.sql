-- Los productos dejan de tener variantes: el precio y el stock pasan al
-- producto, y cada variante de más de un producto pasa a ser un producto propio.

-- 1. Lo nuevo, todavía sin sacar nada.
ALTER TABLE "Producto" ADD COLUMN "precioCentavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stock" INTEGER,
ADD COLUMN "disponible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "stockMinimo" INTEGER;

ALTER TABLE "ItemVenta" ADD COLUMN "productoId" TEXT;

-- 2. Qué variante se queda en su producto y cuáles pasan a ser otro. Se queda
-- la primera activa (o, si no hay activas, la primera); las demás activas de un
-- producto con más de una activa se separan. Las inactivas sólo importan por
-- las ventas que las nombran: quedan en su producto.
CREATE TEMP TABLE variantes_orden AS
SELECT v.*,
       row_number() OVER (PARTITION BY v."productoId" ORDER BY v."activo" DESC, v."createdAt", v."id") AS orden,
       count(*) FILTER (WHERE v."activo") OVER (PARTITION BY v."productoId") AS activas
FROM "Variante" v;

CREATE TEMP TABLE variantes_separadas AS
SELECT vo.*, p."userId", p."nombre" AS "nombreProducto", p."codigo" AS "codigoProducto"
FROM variantes_orden vo JOIN "Producto" p ON p."id" = vo."productoId"
WHERE vo."activo" AND vo."activas" > 1 AND vo."orden" > 1;

-- 3. El producto original toma el precio y el stock de la variante que se queda
-- y, si tenía varias, su nombre.
UPDATE "Producto" p
SET "precioCentavos" = vo."precioCentavos",
    "stock" = vo."stock",
    "disponible" = vo."disponible",
    "stockMinimo" = vo."stockMinimo",
    "nombre" = CASE WHEN vo."activas" > 1 AND vo."nombre" <> '' THEN left(p."nombre" || ' – ' || vo."nombre", 120) ELSE p."nombre" END
FROM variantes_orden vo
WHERE vo."productoId" = p."id" AND vo."orden" = 1;

-- 4. Cada variante separada es un producto nuevo con su id, su SKU como código
-- (con un sufijo si ese código ya está tomado en la cuenta) y el resto del original.
INSERT INTO "Producto" (
  "id", "userId", "codigo", "nombre", "descripcion", "categoria", "moneda", "activo",
  "precioCentavos", "stock", "disponible", "stockMinimo", "cuotasMax", "createdAt", "updatedAt"
)
SELECT
  vs."id",
  vs."userId",
  CASE
    WHEN EXISTS (SELECT 1 FROM "Producto" otro WHERE otro."userId" = vs."userId" AND otro."codigo" = vs."sku")
      OR (SELECT count(*) FROM variantes_separadas dup WHERE dup."userId" = vs."userId" AND dup."sku" = vs."sku") > 1
    THEN left(vs."sku", 53) || '-' || right(vs."id", 6)
    ELSE vs."sku"
  END,
  left(vs."nombreProducto" || ' – ' || CASE WHEN length(vs."nombre") > 0 THEN vs."nombre" ELSE vs."sku" END, 120),
  p."descripcion", p."categoria", p."moneda", p."activo",
  vs."precioCentavos", vs."stock", vs."disponible", vs."stockMinimo", p."cuotasMax",
  vs."createdAt", now()
FROM variantes_separadas vs JOIN "Producto" p ON p."id" = vs."productoId";

-- El descuento propio del original vale también para los separados.
INSERT INTO "Descuento" ("id", "userId", "productoId", "nombre", "tipo", "valor", "activo", "desde", "hasta", "createdAt", "updatedAt")
SELECT 'dsc_' || vs."id", d."userId", vs."id", d."nombre", d."tipo", d."valor", d."activo", d."desde", d."hasta", d."createdAt", now()
FROM variantes_separadas vs JOIN "Descuento" d ON d."productoId" = vs."productoId";

-- 5. Las ventas apuntan al producto, y el nombre de la variante queda en el del renglón.
UPDATE "ItemVenta" i
SET "productoId" = CASE WHEN vs."id" IS NOT NULL THEN vs."id" ELSE v."productoId" END
FROM "Variante" v LEFT JOIN variantes_separadas vs ON vs."id" = v."id"
WHERE i."varianteId" = v."id";

UPDATE "ItemVenta" SET "nombreProducto" = "nombreProducto" || ' (' || "nombreVariante" || ')'
WHERE length("nombreVariante") > 0;

-- 6. El texto de búsqueda ya no lleva variantes ni SKUs: se recalcula (mismo
-- formato que textoBusquedaDe) y el indexador rehace los embeddings al ver que
-- cambió.
UPDATE "Producto"
SET "textoBusqueda" = btrim(regexp_replace(lower(translate(
      concat_ws(' | ', nullif("nombre", ''), nullif("categoria", ''), nullif("descripcion", ''), nullif("codigo", '')),
      'ÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüàèìòùâêîôûäëïö',
      'AEIOUUAEIOUAEIOUAEIOaeiouuaeiouaeiouaeio')), '\s+', ' ', 'g'))
WHERE "id" IS NOT NULL;
UPDATE "Producto" SET "busqueda" = to_tsvector('spanish', "textoBusqueda") WHERE "id" IS NOT NULL;

-- 7. Ya sin uso: las variantes.
ALTER TABLE "Producto" ALTER COLUMN "precioCentavos" DROP DEFAULT;

-- DropForeignKey
ALTER TABLE "ItemVenta" DROP CONSTRAINT "ItemVenta_varianteId_fkey";

-- DropForeignKey
ALTER TABLE "Variante" DROP CONSTRAINT "Variante_productoId_fkey";

-- DropIndex
DROP INDEX "ItemVenta_varianteId_idx";

-- AlterTable
ALTER TABLE "ItemVenta" DROP COLUMN "nombreVariante",
DROP COLUMN "varianteId";

-- DropTable
DROP TABLE "Variante";

-- CreateIndex
CREATE INDEX "ItemVenta_productoId_idx" ON "ItemVenta"("productoId");

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
