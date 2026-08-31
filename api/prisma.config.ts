import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7: la URL de conexión ya no va en schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
