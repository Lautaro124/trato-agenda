/**
 * Base de datos real para los specs que prueban SQL crudo (búsqueda del
 * catálogo, reservas con FOR UPDATE): eso no se puede probar con un Prisma
 * de mentira. Corren sólo con TEST_DATABASE_URL, una base ya migrada con
 * pgvector — en CI la levanta el job de la API; en local:
 *
 *   createdb trato_test
 *   DATABASE_URL=postgresql://…/trato_test npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://…/trato_test npm test
 *
 * Cada spec crea sus propios usuarios y los borra al terminar (la cascada se
 * lleva todo lo demás), así que pueden correr contra una base compartida.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.js';
import type { User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const URL_BASE_DE_PRUEBA = process.env.TEST_DATABASE_URL ?? '';

/** Para `describe.skipIf(!hayBaseDePrueba)`. */
export const hayBaseDePrueba = URL_BASE_DE_PRUEBA !== '';

export function crearPrismaDePrueba(): PrismaService {
  const config = { get: () => URL_BASE_DE_PRUEBA } as unknown as ConfigService<Env, true>;
  return new PrismaService(config);
}

export async function crearUsuarioDePrueba(prisma: PrismaService, datos: Partial<User> = {}): Promise<User> {
  return prisma.user.create({
    data: { name: 'Prueba', calendario: 'local', googleId: `test:${randomUUID()}`, ...datos },
  });
}
