-- Lápida de la prueba gratis: sobrevive a la baja de la cuenta para no repetir el mes de prueba.
CREATE TABLE "PruebaConsumida" (
    "id" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PruebaConsumida_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PruebaConsumida_huella_key" ON "PruebaConsumida"("huella");
