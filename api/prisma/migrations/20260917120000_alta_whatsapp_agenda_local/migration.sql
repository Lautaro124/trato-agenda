-- Alta sólo con WhatsApp y agenda local: googleId y email dejan de ser
-- obligatorios, el número vinculado pasa a identificar la cuenta, y los
-- usuarios sin Google Calendar guardan su agenda en la tabla Evento.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendario" TEXT NOT NULL DEFAULT 'google',
ADD COLUMN     "phoneNumber" TEXT,
ALTER COLUMN "googleId" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumen" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoAcceso" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evento_userId_inicio_idx" ON "Evento"("userId", "inicio");

-- CreateIndex
CREATE INDEX "CodigoAcceso_userId_idx" ON "CodigoAcceso"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoAcceso" ADD CONSTRAINT "CodigoAcceso_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Los usuarios del login de desarrollo usaban un calendario en memoria;
-- ahora usan la agenda local, que sobrevive a los reinicios.
UPDATE "User" SET "calendario" = 'local' WHERE "googleId" LIKE 'dev:%';

-- Los usuarios que ya vincularon WhatsApp pueden entrar con código desde ya.
-- Si dos cuentas vincularon el mismo número (no debería pasar), ninguna lo toma.
UPDATE "User" u
SET "phoneNumber" = w."phoneNumber"
FROM "WhatsappSession" w
WHERE w."userId" = u."id"
  AND w."registered" = true
  AND w."phoneNumber" IS NOT NULL
  AND (SELECT count(*) FROM "WhatsappSession" o
       WHERE o."phoneNumber" = w."phoneNumber" AND o."registered" = true) = 1;
