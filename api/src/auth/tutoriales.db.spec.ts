/**
 * El UPDATE de `POST /auth/tutoriales` es SQL crudo: contra Postgres real
 * tiene que sumar claves sin duplicarlas ni tocar a otros usuarios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { AuthController } from './auth.controller.js';

describe.skipIf(!hayBaseDePrueba)('marcar tutoriales vistos (Postgres)', () => {
  let prisma: PrismaService;
  let controller: AuthController;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    // Este endpoint sólo usa Prisma.
    const nada = null as never;
    controller = new AuthController(nada, nada, nada, nada, nada, prisma, nada);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('suma sin duplicar y no toca a otras cuentas', async () => {
    const usuario = await crearUsuarioDePrueba(prisma);
    const otro = await crearUsuarioDePrueba(prisma);
    try {
      await controller.marcarTutoriales(usuario, { claves: ['inicio'] });
      await Promise.all([
        controller.marcarTutoriales(usuario, { claves: ['inicio', 'plan'] }),
        controller.marcarTutoriales(usuario, { claves: ['ventas'] }),
      ]);

      const { tutorialesVistos } = await prisma.user.findUniqueOrThrow({ where: { id: usuario.id } });
      expect([...tutorialesVistos].sort()).toEqual(['inicio', 'plan', 'ventas']);
      const ajeno = await prisma.user.findUniqueOrThrow({ where: { id: otro.id } });
      expect(ajeno.tutorialesVistos).toEqual([]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [usuario.id, otro.id] } } });
    }
  });
});
