-- Recomendaciones y flujos conversacionales de la cuenta (LAU-105): las
-- reglas, las propiedades de productos y opciones que consulta el asistente y
-- qué hace cuando no aplica ninguna. Forma y reglas en
-- comercio/recomendaciones.rules.ts.

-- CreateTable
CREATE TABLE "ConfiguracionRecomendaciones" (
    "userId" TEXT NOT NULL,
    "recomendaciones" JSONB NOT NULL DEFAULT '[]',
    "propiedades" JSONB NOT NULL DEFAULT '[]',
    "sinCoincidencia" TEXT NOT NULL DEFAULT 'catalogo',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionRecomendaciones_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "ConfiguracionRecomendaciones" ADD CONSTRAINT "ConfiguracionRecomendaciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
