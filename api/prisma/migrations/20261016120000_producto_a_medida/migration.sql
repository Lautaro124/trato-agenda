-- Productos a medida: el asistente no cuenta materiales ni fabricación salvo que se lo pregunten.
ALTER TABLE "Producto" ADD COLUMN "aMedida" BOOLEAN NOT NULL DEFAULT false;
