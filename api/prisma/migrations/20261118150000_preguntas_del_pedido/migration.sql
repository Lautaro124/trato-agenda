-- Preguntas del pedido de la cuenta (LAU-100): globales y por producto, con
-- opciones condicionales, imágenes y notas en el pedido. Las preguntas que
-- tenía cada producto pasan a la configuración de su cuenta y la columna vieja
-- se borra.

-- CreateTable
CREATE TABLE "ConfiguracionPreguntas" (
    "userId" TEXT NOT NULL,
    "preguntas" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionPreguntas_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ImagenPregunta" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagenPregunta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImagenPregunta_userId_idx" ON "ImagenPregunta"("userId");

-- AddForeignKey
ALTER TABLE "ConfiguracionPreguntas" ADD CONSTRAINT "ConfiguracionPreguntas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagenPregunta" ADD CONSTRAINT "ImagenPregunta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las respuestas globales y las notas de cada pedido.
ALTER TABLE "Venta" ADD COLUMN "respuestas" JSONB,
ADD COLUMN "notas" JSONB;

-- Las preguntas de cada producto activo pasan a la cuenta con alcance
-- "producto". Las idénticas (mismo texto, tipo, opciones y obligatoriedad) de
-- varios productos quedan como una sola pregunta con todos esos productos.
-- El orden: el del primer producto que la tenía y, dentro de él, el suyo.
WITH legado AS (
    SELECT
        p."userId",
        p."id" AS "productoId",
        p."createdAt",
        e.ord,
        e.val->>'texto' AS texto,
        CASE WHEN e.val->>'tipo' = 'texto' THEN 'texto' ELSE 'opciones' END AS tipo,
        CASE
            WHEN e.val->>'tipo' = 'texto' OR jsonb_typeof(e.val->'opciones') IS DISTINCT FROM 'array' THEN '[]'::jsonb
            ELSE e.val->'opciones'
        END AS opciones,
        COALESCE(e.val->>'obligatoria' = 'true', false) AS obligatoria
    FROM "Producto" p
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(p."preguntasPedido") = 'array' THEN p."preguntasPedido" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(val, ord)
    WHERE p."activo"
      AND jsonb_typeof(e.val) = 'object'
      AND COALESCE(btrim(e.val->>'texto'), '') <> ''
),
agrupadas AS (
    SELECT
        "userId",
        texto,
        tipo,
        opciones,
        obligatoria,
        jsonb_agg("productoId" ORDER BY "createdAt", "productoId") AS productos,
        MIN("createdAt") AS desde,
        MIN(ord) AS ord
    FROM legado
    GROUP BY "userId", texto, tipo, opciones, obligatoria
)
INSERT INTO "ConfiguracionPreguntas" ("userId", "preguntas", "updatedAt")
SELECT
    a."userId",
    jsonb_agg(
        jsonb_build_object(
            'id', 'q' || substr(md5(a.texto || '|' || a.tipo || '|' || a.opciones::text || '|' || a.obligatoria::text), 1, 20),
            'texto', a.texto,
            'tipo', a.tipo,
            'obligatoria', a.obligatoria,
            'alcance', 'producto',
            'productos', a.productos,
            'imagenId', NULL,
            'ayuda', NULL,
            'dependeDe', NULL,
            'otra', NULL,
            'opciones', (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object('id', 'o' || o.ord, 'texto', o.val, 'imagenId', NULL, 'soloSi', '[]'::jsonb)
                        ORDER BY o.ord
                    ),
                    '[]'::jsonb
                )
                FROM jsonb_array_elements_text(a.opciones) WITH ORDINALITY AS o(val, ord)
            )
        )
        ORDER BY a.desde, a.ord, a.texto
    ),
    CURRENT_TIMESTAMP
FROM agrupadas a
GROUP BY a."userId";

-- La columna vieja: sus preguntas ya están en ConfiguracionPreguntas.
ALTER TABLE "Producto" DROP COLUMN "preguntasPedido";
