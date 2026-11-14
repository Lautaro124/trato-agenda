-- Módulo de performance: cuándo el chat consultó el envío (consultar_envio).
ALTER TABLE "EtapaChat" ADD COLUMN "consultoEnvioAt" TIMESTAMP(3);
