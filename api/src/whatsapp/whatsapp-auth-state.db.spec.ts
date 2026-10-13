/**
 * La sesión de WhatsApp contra Postgres real (LAU-18): una fila por clave,
 * cifrada una por una, la migración del blob viejo y la copia al transferir.
 */
import { randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../auth/token-crypto.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { copiarSesion, idDeFila, usePrismaAuthState } from './whatsapp-auth-state.js';

const ME = { id: '5491155551234:1@s.whatsapp.net', name: '~' };

describe.skipIf(!hayBaseDePrueba)('usePrismaAuthState (Postgres real)', () => {
  const clave = randomBytes(32).toString('hex');
  let prisma: PrismaService;
  const usuarios: User[] = [];

  async function nuevoUsuario(): Promise<User> {
    const usuario = await crearUsuarioDePrueba(prisma);
    usuarios.push(usuario);
    return usuario;
  }

  const filasDe = (userId: string) =>
    prisma.whatsappClave.findMany({ where: { userId }, orderBy: [{ categoria: 'asc' }, { clave: 'asc' }] });

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: usuarios.map((u) => u.id) } } });
    await prisma.$disconnect();
  });

  it('guarda creds y claves, y los recupera tras un "reinicio"', async () => {
    const { id } = await nuevoUsuario();
    const primero = await usePrismaAuthState(prisma, id, clave);
    const claveDeSesion = new Uint8Array([1, 2, 3, 4]);
    const sync = proto.Message.AppStateSyncKeyData.fromObject({ keyData: Buffer.from([7, 7]), timestamp: 1 });

    // Antes del primer saveCreds, como hace Baileys con las pre-keys: la sesión se crea sola.
    await primero.state.keys.set({ session: { 'device-1': claveDeSesion }, 'app-state-sync-key': { AAA: sync } });
    primero.state.creds.me = ME;
    await primero.saveCreds();

    const segundo = await usePrismaAuthState(prisma, id, clave);

    expect(segundo.state.creds.me?.id).toBe(ME.id);
    const sesion = await segundo.state.keys.get('session', ['device-1', 'no-existe']);
    expect(Array.from(sesion['device-1']!)).toEqual([1, 2, 3, 4]);
    expect(sesion['no-existe']).toBeUndefined();
    const leida = await segundo.state.keys.get('app-state-sync-key', ['AAA']);
    expect(leida.AAA).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
    expect(Array.from(leida.AAA!.keyData!)).toEqual([7, 7]);

    const fila = await prisma.whatsappSession.findUniqueOrThrow({ where: { userId: id } });
    expect(fila.registered).toBe(true);
    expect(fila.phoneNumber).toBe('5491155551234');
  });

  it('cada clave va en su fila y cifrada, y las credenciales ya no llevan las claves', async () => {
    const { id } = await nuevoUsuario();
    const { state, saveCreds } = await usePrismaAuthState(prisma, id, clave);
    await state.keys.set({ 'pre-key': { '1': { public: Buffer.from('pub'), private: Buffer.from('secreto') } } });
    await saveCreds();

    const [fila] = await filasDe(id);
    expect(fila).toMatchObject({ categoria: 'pre-key', clave: idDeFila('pre-key', '1', clave) });
    expect(fila!.valor).not.toContain('secreto');
    expect(fila!.valor.split(':')).toHaveLength(3);

    const sesion = await prisma.whatsappSession.findUniqueOrThrow({ where: { userId: id } });
    expect(Object.keys(JSON.parse(decryptToken(sesion.authState, clave)))).toEqual(['creds']);
  });

  it('el id de una sesión es el JID del cliente: en la fila no queda su teléfono', async () => {
    const { id } = await nuevoUsuario();
    const { state } = await usePrismaAuthState(prisma, id, clave);
    await state.keys.set({ session: { '5491122334455.0': new Uint8Array([1]) } });

    const [fila] = await filasDe(id);
    expect(fila!.clave).not.toContain('5491122334455');
    expect(Array.from((await state.keys.get('session', ['5491122334455.0']))['5491122334455.0']!)).toEqual([1]);
  });

  it('cada keys.set escribe sólo lo que cambió: actualiza, borra con null y deja el resto', async () => {
    const { id } = await nuevoUsuario();
    const { state } = await usePrismaAuthState(prisma, id, clave);
    await state.keys.set({ session: { a: new Uint8Array([1]), b: new Uint8Array([2]), c: new Uint8Array([3]) } });

    await state.keys.set({ session: { a: new Uint8Array([9]), b: null } });

    const leido = await state.keys.get('session', ['a', 'b', 'c']);
    expect(Array.from(leido.a!)).toEqual([9]);
    expect(leido.b).toBeUndefined();
    expect(Array.from(leido.c!)).toEqual([3]);
    expect((await filasDe(id)).map((f) => f.clave).sort()).toEqual(
      [idDeFila('session', 'a', clave), idDeFila('session', 'c', clave)].sort(),
    );
  });

  it('una sesión de antes de LAU-18 (un solo blob) se parte en filas al cargarla, una sola vez', async () => {
    const { id } = await nuevoUsuario();
    const creds = { ...initAuthCreds(), me: ME };
    const keys = {
      'pre-key': Object.fromEntries(
        Array.from({ length: 812 }, (_, i) => [String(i + 1), { public: Buffer.from([i % 256]), private: Buffer.from([1]) }]),
      ),
      session: { 'device-1': Buffer.from([4, 2]) },
    };
    await prisma.whatsappSession.create({
      data: {
        userId: id,
        authState: encryptToken(JSON.stringify({ creds, keys }, BufferJSON.replacer), clave),
        registered: true,
      },
    });

    const migrada = await usePrismaAuthState(prisma, id, clave);

    expect(migrada.state.creds.me?.id).toBe(ME.id);
    expect(await prisma.whatsappClave.count({ where: { userId: id } })).toBe(813);
    const sesion = await prisma.whatsappSession.findUniqueOrThrow({ where: { userId: id } });
    expect(Object.keys(JSON.parse(decryptToken(sesion.authState, clave)))).toEqual(['creds']);
    expect(sesion.registered).toBe(true);
    const leido = await migrada.state.keys.get('session', ['device-1']);
    expect(Array.from(leido['device-1']!)).toEqual([4, 2]);

    // Volver a cargar no vuelve a migrar ni duplica nada.
    await usePrismaAuthState(prisma, id, clave);
    expect(await prisma.whatsappClave.count({ where: { userId: id } })).toBe(813);
  });

  it('si las credenciales no descifran (TOKEN_ENCRYPTION_KEY rotada), arranca de cero y sin las claves viejas', async () => {
    const { id } = await nuevoUsuario();
    const primero = await usePrismaAuthState(prisma, id, clave);
    await primero.state.keys.set({ session: { a: new Uint8Array([1]) } });
    primero.state.creds.me = ME;
    await primero.saveCreds();

    const segundo = await usePrismaAuthState(prisma, id, randomBytes(32).toString('hex'));

    expect(segundo.state.creds.me).toBeUndefined();
    expect(await filasDe(id)).toEqual([]);
  });

  it('borrar la sesión (desvincular) se lleva sus claves, y la baja de la cuenta también', async () => {
    const uno = await nuevoUsuario();
    const otro = await nuevoUsuario();
    for (const { id } of [uno, otro]) {
      const { state } = await usePrismaAuthState(prisma, id, clave);
      await state.keys.set({ session: { a: new Uint8Array([1]) } });
    }

    await prisma.whatsappSession.deleteMany({ where: { userId: uno.id } });
    await prisma.user.delete({ where: { id: otro.id } });

    expect(await filasDe(uno.id)).toEqual([]);
    expect(await filasDe(otro.id)).toEqual([]);
  });

  it('si el usuario ya no existe, guardar avisa y sigue en vez de romper adentro de Baileys', async () => {
    const { state, saveCreds } = await usePrismaAuthState(prisma, 'usuario-que-no-existe', clave);

    await expect(state.keys.set({ session: { a: new Uint8Array([1]) } })).resolves.toBeUndefined();
    await expect(saveCreds()).resolves.toBeUndefined();
  });

  it('copiarSesion pasa credenciales y claves a la cuenta, reemplaza las suyas y borra las del alta', async () => {
    const alta = await nuevoUsuario();
    const cuenta = await nuevoUsuario();
    const nueva = await usePrismaAuthState(prisma, alta.id, clave);
    await nueva.state.keys.set({ session: { nueva: new Uint8Array([1]) }, 'pre-key': { '1': { public: Buffer.from([1]), private: Buffer.from([2]) } } });
    nueva.state.creds.me = ME;
    await nueva.saveCreds();
    const vieja = await usePrismaAuthState(prisma, cuenta.id, clave);
    await vieja.state.keys.set({ session: { vieja: new Uint8Array([9]) } });

    await copiarSesion(prisma, alta.id, cuenta.id);

    expect(await prisma.whatsappSession.findUnique({ where: { userId: alta.id } })).toBeNull();
    expect(await filasDe(alta.id)).toEqual([]);
    expect((await filasDe(cuenta.id)).map((f) => f.categoria)).toEqual(['pre-key', 'session']);
    const recargada = await usePrismaAuthState(prisma, cuenta.id, clave);
    expect(recargada.state.creds.me?.id).toBe(ME.id);
    const leido = await recargada.state.keys.get('session', ['nueva']);
    expect(Array.from(leido.nueva!)).toEqual([1]);
  });
});
