-- Preguntas por producto y las respuestas del cliente en cada renglón del pedido.
ALTER TABLE "Producto" ADD COLUMN "preguntasPedido" JSONB;
ALTER TABLE "ItemVenta" ADD COLUMN "respuestas" JSONB;
