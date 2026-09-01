import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { usePrismaAuthState } from './whatsapp-auth-state.js';

type Fila = {
  userId: string;
  authState: string;
  phoneNumber: string | null;
  registered: boolean;
  linkedAt: Date | null;
};

/** Store en memoria que imita las dos únicas operaciones que usa el adapter. */
function crearPrismaFake() {
  const filas = new Map<string, Fila>();
  return {
    whatsappSession: {
      findUnique: async ({ where: { userId } }: { where: { userId: string } }) =>
        filas.get(userId) ?? null,
      upsert: async ({
        where: { userId },
        create,
        update,
      }: {
        where: { userId: string };
        create: Omit<Fila, 'userId'>;
        update: Omit<Fila, 'userId'>;
      }) => {
        const fila = { userId, ...(filas.has(userId) ? update : create) };
        filas.set(userId, fila);
        return fila;
      },
    },
  } as unknown as PrismaService;
}

describe('usePrismaAuthState', () => {
  const clave = randomBytes(32).toString('hex');

  it('persiste creds y keys, y los recupera tras un "reinicio"', async () => {
    const prisma = crearPrismaFake();
    const userId = 'user-1';

    const primero = await usePrismaAuthState(prisma, userId, clave);
    const claveDeSesion = new Uint8Array([1, 2, 3, 4]);
    await primero.state.keys.set({ session: { 'device-1': claveDeSesion } });

    primero.state.creds.registered = true;
    primero.state.creds.me = { id: '5491155551234:1@s.whatsapp.net' } as never;
    await primero.saveCreds();

    // Nueva instancia del adapter contra el mismo store: simula un restart de la API.
    const segundo = await usePrismaAuthState(prisma, userId, clave);

    expect(segundo.state.creds.registered).toBe(true);
    const leido = await segundo.state.keys.get('session', ['device-1']);
    expect(Array.from(leido['device-1'])).toEqual(Array.from(claveDeSesion));
  });

  it('el blob guardado en la fila está cifrado, no en texto plano', async () => {
    const prisma = crearPrismaFake();
    const { saveCreds } = await usePrismaAuthState(prisma, 'user-2', clave);
    await saveCreds();

    const fila = await (
      prisma as unknown as { whatsappSession: { findUnique: (a: unknown) => Promise<Fila> } }
    ).whatsappSession.findUnique({ where: { userId: 'user-2' } });

    expect(fila.authState).not.toContain('registered');
    expect(fila.authState.split(':')).toHaveLength(3);
  });

  it('si el blob no descifra (TOKEN_ENCRYPTION_KEY rotada), arranca de cero en vez de tirar', async () => {
    const prisma = crearPrismaFake();
    const userId = 'user-3';
    const primero = await usePrismaAuthState(prisma, userId, clave);
    primero.state.creds.registered = true;
    await primero.saveCreds();

    const otraClave = randomBytes(32).toString('hex');
    const segundo = await usePrismaAuthState(prisma, userId, otraClave);

    expect(segundo.state.creds.registered).toBe(false);
  });

  it('borrar una clave (set con valor null) la saca del store', async () => {
    const prisma = crearPrismaFake();
    const userId = 'user-4';
    const { state } = await usePrismaAuthState(prisma, userId, clave);

    await state.keys.set({ session: { 'device-1': new Uint8Array([9]) } });
    await state.keys.set({ session: { 'device-1': null } });

    const leido = await state.keys.get('session', ['device-1']);
    expect(leido['device-1']).toBeUndefined();
  });
});
