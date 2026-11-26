-- Sólo las cuentas que ya usaban WhatsApp por QR o código (Baileys) pueden
-- seguir vinculando así; las nuevas conectan por la API oficial de Meta.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "vinculaConBaileys" BOOLEAN NOT NULL DEFAULT false;

-- Las cuentas existentes con un número o una sesión de Baileys la conservan.
UPDATE "User" u
SET "vinculaConBaileys" = true
WHERE u."phoneNumber" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "WhatsappSession" s WHERE s."userId" = u."id");
