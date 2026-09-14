-- Reemplazo de la generación de agentes por IA por una plantilla determinista:
-- ya no siempre hay un modelo de OpenRouter que guardar en `model`, así que
-- pasa a ser opcional. `templateVersion` distingue los agentes generados por
-- la plantilla (valor no nulo) de los agentes legados generados por IA
-- (siguen con `model` no nulo y `templateVersion` nulo).
ALTER TABLE "Agent" ALTER COLUMN "model" DROP NOT NULL;
ALTER TABLE "Agent" ADD COLUMN "templateVersion" INTEGER;
