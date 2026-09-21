-- Login con número de WhatsApp + contraseña. Sólo el hash (scrypt); las
-- cuentas existentes quedan sin contraseña y la ponen desde la recuperación.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
