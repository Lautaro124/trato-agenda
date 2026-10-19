/** Tope diario de sugerencias contra Postgres real: el lock por cuenta es SQL crudo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { LinearClient } from './linear.client.js';
import { MAX_POR_DIA } from './mejoras.rules.js';
import { MejorasService } from './mejoras.service.js';

describe.skipIf(!hayBaseDePrueba)('sugerencias de mejora (Postgres)', () => {
  let prisma: PrismaService;
  let servicio: MejorasService;
  let dueno: User;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    const linear = { configurado: () => false } as unknown as LinearClient;
    servicio = new MejorasService(prisma, linear);
    dueno = await crearUsuarioDePrueba(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: dueno.id } });
    await prisma.$disconnect();
  });

  it('con envíos simultáneos no deja pasar más del tope diario y guarda el texto normalizado', async () => {
    const intentos = await Promise.allSettled(
      Array.from({ length: MAX_POR_DIA + 3 }, (_, i) =>
        servicio.crear(dueno.id, 'idea', `  Sugerencia número ${i}\r\ncon dos líneas  `),
      ),
    );
    await servicio.esperar();

    expect(intentos.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_POR_DIA);
    const rechazos = intentos.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rechazos).toHaveLength(3);
    expect(rechazos.every((r) => (r.reason as { getStatus?: () => number }).getStatus?.() === 429)).toBe(true);

    const guardadas = await prisma.sugerenciaMejora.findMany({ where: { userId: dueno.id } });
    expect(guardadas).toHaveLength(MAX_POR_DIA);
    expect(guardadas.every((s) => /^Sugerencia número \d\ncon dos líneas$/.test(s.texto))).toBe(true);
    expect(guardadas.every((s) => s.enviadaAt === null && s.linearIssueId === null)).toBe(true);
  });
});
