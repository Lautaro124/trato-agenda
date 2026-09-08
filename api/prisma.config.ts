import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7: la URL de conexión ya no va en schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Leída directo y no con env() de prisma/config, que explota apenas falta:
    // `prisma generate` corre en el build de la imagen, donde todavía no hay
    // base. Quien sí necesita conectarse (migrate deploy, en el arranque del
    // contenedor) ya la tiene definida por el entorno.
    url: process.env.DATABASE_URL ?? '',
  },
});
