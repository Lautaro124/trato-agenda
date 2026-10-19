-- Productos a medida (LAU-22): las preguntas que el asistente le hace al
-- cliente para presupuestar. Null = el producto no se hace a medida, que es
-- el caso de todos los que ya existen.
ALTER TABLE "Producto" ADD COLUMN "solicitud" JSONB;
