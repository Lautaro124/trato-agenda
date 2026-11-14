-- CreateTable
CREATE TABLE "ConfiguracionEnvios" (
    "userId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "pais" TEXT NOT NULL DEFAULT 'AR',
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "sinTarifa" TEXT NOT NULL DEFAULT 'derivar',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionEnvios_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ZonaEnvio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "estado" TEXT NOT NULL,
    "domicilio" BOOLEAN NOT NULL DEFAULT false,
    "sucursal" BOOLEAN NOT NULL DEFAULT false,
    "tarifaDomicilioCentavos" INTEGER,
    "tarifaSucursalCentavos" INTEGER,
    "gratisDesdeCentavos" INTEGER,
    "preparacionDias" INTEGER,
    "transporteDesdeDias" INTEGER,
    "transporteHastaDias" INTEGER,
    "diasDespacho" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instrucciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZonaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoberturaZona" (
    "id" TEXT NOT NULL,
    "zonaId" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "provinciaId" TEXT,
    "localidadId" TEXT,
    "cp" TEXT,

    CONSTRAINT "CoberturaZona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultaEnvioSinResolver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "provinciaId" TEXT,
    "localidadId" TEXT,
    "cp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultaEnvioSinResolver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZonaEnvio_userId_idx" ON "ZonaEnvio"("userId");

-- CreateIndex
CREATE INDEX "CoberturaZona_zonaId_idx" ON "CoberturaZona"("zonaId");

-- CreateIndex
CREATE INDEX "ConsultaEnvioSinResolver_userId_createdAt_idx" ON "ConsultaEnvioSinResolver"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultaEnvioSinResolver_createdAt_idx" ON "ConsultaEnvioSinResolver"("createdAt");

-- AddForeignKey
ALTER TABLE "ConfiguracionEnvios" ADD CONSTRAINT "ConfiguracionEnvios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonaEnvio" ADD CONSTRAINT "ZonaEnvio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoberturaZona" ADD CONSTRAINT "CoberturaZona_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "ZonaEnvio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultaEnvioSinResolver" ADD CONSTRAINT "ConsultaEnvioSinResolver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
