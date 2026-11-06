-- Las cuotas pasan de la cuenta (CondicionesPago.planesCuotas) a cada producto
-- (Producto.cuotas). Expandir → copiar → contraer, en una transacción.

-- 1. Expandir.
ALTER TABLE "Producto" ADD COLUMN "cuotas" JSONB;

-- 2. Copiar los planes de la cuenta a cada producto en pesos, respetando su
--    tope (cuotasMax; 1 = en un pago). Si los planes que le tocan tienen todos
--    el mismo recargo, queda como recargo único; si no, como total por plan
--    (precio de lista más el recargo, redondeado). Los en dólares quedan en un
--    pago, como hasta ahora.
WITH planes AS (
  SELECT p."id",
         p."precioCentavos",
         -- Sólo numeric acá: un valor raro no puede abortar el deploy por un cast.
         CASE WHEN jsonb_typeof(pl.valor -> 'cuotas') = 'number' THEN (pl.valor ->> 'cuotas')::numeric END AS cuotas,
         CASE WHEN jsonb_typeof(pl.valor -> 'recargoPorcentaje') = 'number'
              THEN (pl.valor ->> 'recargoPorcentaje')::numeric END AS recargo
  FROM "Producto" p
  JOIN "CondicionesPago" cp ON cp."userId" = p."userId"
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(cp."planesCuotas") = 'array' THEN cp."planesCuotas" ELSE '[]'::jsonb END
  ) AS pl(valor)
  WHERE p."moneda" = 'ARS'
),
validos AS (
  SELECT pl.*
  FROM planes pl
  JOIN "Producto" p ON p."id" = pl."id"
  WHERE pl.cuotas BETWEEN 2 AND 24
    AND pl.cuotas = trunc(pl.cuotas)
    AND pl.recargo BETWEEN 0 AND 100
    AND pl.recargo = trunc(pl.recargo)
    AND (p."cuotasMax" IS NULL OR pl.cuotas <= p."cuotasMax")
),
por_producto AS (
  SELECT "id",
         CASE
           WHEN count(DISTINCT recargo) = 1 THEN jsonb_build_object(
             'modo', 'recargo',
             'recargoPorcentaje', round(min(recargo)),
             'planes', jsonb_agg(round(cuotas) ORDER BY cuotas)
           )
           ELSE jsonb_build_object(
             'modo', 'precios',
             'planes', jsonb_agg(
               jsonb_build_object(
                 'cuotas', round(cuotas),
                 -- En numeric: precio × (100 + recargo) no entra en un int4.
                 'totalCentavos', round("precioCentavos"::numeric * (100 + recargo) / 100)
               ) ORDER BY cuotas
             )
           )
         END AS cuotas
  FROM validos
  GROUP BY "id", "precioCentavos"
)
UPDATE "Producto" p
SET "cuotas" = pp.cuotas
FROM por_producto pp
WHERE pp."id" = p."id";

-- 3. Contraer.
ALTER TABLE "Producto" DROP COLUMN "cuotasMax";
ALTER TABLE "CondicionesPago" DROP COLUMN "planesCuotas";
