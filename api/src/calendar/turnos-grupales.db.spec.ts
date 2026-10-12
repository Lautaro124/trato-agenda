/**
 * Turnos grupales contra Postgres real: el lock por clase de
 * `inscribirEnTurnoGrupal` es SQL crudo (pg_advisory_xact_lock) y es lo único
 * que impide que dos chats a la vez se queden con el último lugar. Eso no se
 * puede probar con un Prisma de mentira.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { CalendarService } from './calendar.service.js';

const CONFIG = { get: () => undefined } as unknown as ConfigService<Env, true>;
const CLASE = { tipo: 'Yoga', inicio: new Date('2026-09-01T15:00:00Z'), fin: new Date('2026-09-01T16:00:00Z') };

describe.skipIf(!hayBaseDePrueba)('turnos grupales (Postgres)', () => {
  let prisma: PrismaService;
  const usuarios: User[] = [];

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: usuarios.map((usuario) => usuario.id) } } });
    await prisma.$disconnect();
  });

  async function duenoConChats(cantidad: number) {
    const dueno = await crearUsuarioDePrueba(prisma);
    usuarios.push(dueno);
    const chats = await Promise.all(
      Array.from({ length: cantidad }, (_, indice) =>
        prisma.conversation.create({ data: { userId: dueno.id, remoteJid: `54911000${indice}@s.whatsapp.net` } }),
      ),
    );
    return { dueno, chats };
  }

  it('con varios chats a la vez, entran sólo los que caben y comparten un único evento', async () => {
    const { dueno, chats } = await duenoConChats(5);
    const service = new CalendarService(CONFIG, prisma);

    const resultados = await Promise.all(
      chats.map((chat, indice) =>
        service.inscribirEnTurnoGrupal(dueno, {
          conversationId: chat.id,
          nombreCliente: `Cliente ${indice}`,
          ...CLASE,
          capacidad: 2,
        }),
      ),
    );

    expect(resultados.filter((resultado) => resultado.ok)).toHaveLength(2);
    expect(resultados.filter((resultado) => !resultado.ok)).toEqual([
      { ok: false, motivo: 'completa' },
      { ok: false, motivo: 'completa' },
      { ok: false, motivo: 'completa' },
    ]);
    const turnos = await prisma.turno.findMany({ where: { conversation: { userId: dueno.id } } });
    expect(new Set(turnos.map((turno) => turno.googleEventId)).size).toBe(1);
    const eventos = await prisma.evento.findMany({ where: { userId: dueno.id } });
    expect(eventos).toEqual([expect.objectContaining({ resumen: 'Yoga (grupal) · 2/2', id: turnos[0].googleEventId })]);
  });

  it('la baja libera el lugar y la del último borra el evento', async () => {
    const { dueno, chats } = await duenoConChats(2);
    const service = new CalendarService(CONFIG, prisma);
    const anotar = (indice: number) =>
      service.inscribirEnTurnoGrupal(dueno, {
        conversationId: chats[indice].id,
        nombreCliente: `Cliente ${indice}`,
        ...CLASE,
        capacidad: 2,
      });
    const primero = await anotar(0);
    const segundo = await anotar(1);
    if (!primero.ok || !segundo.ok) throw new Error('No se pudo anotar');

    await expect(service.bajaDeTurnoGrupal(dueno, { ...primero.turno, tipo: 'Yoga' }, 2)).resolves.toBe(1);
    expect(await prisma.evento.findMany({ where: { userId: dueno.id } })).toEqual([
      expect.objectContaining({ resumen: 'Yoga (grupal) · 1/2' }),
    ]);

    await expect(service.bajaDeTurnoGrupal(dueno, { ...segundo.turno, tipo: 'Yoga' }, 2)).resolves.toBe(0);
    expect(await prisma.evento.count({ where: { userId: dueno.id } })).toBe(0);
    expect(await prisma.turno.count({ where: { conversation: { userId: dueno.id }, estado: 'confirmado' } })).toBe(0);
  });
});
