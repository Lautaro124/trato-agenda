import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Mutex } from 'async-mutex';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { decryptToken, encryptToken } from '../auth/token-crypto.js';
import { MedidorDeGuardados } from './metricas.js';

const logger = new Logger('WhatsappAuthState');

/** `P2003` de Prisma: la fila a la que apunta (el usuario, la sesión) ya no existe. */
const CODIGO_FK_VIOLADA = 'P2003';
/** Lo mismo, dicho por Postgres: así llega desde SQL crudo. */
const CODIGO_FK_VIOLADA_PG = '23503';
/** Filas por INSERT: una sesión recién vinculada trae cientos de pre-keys. */
const FILAS_POR_LOTE = 500;

type KeyBucket = { [category: string]: { [id: string]: unknown } };

/** El blob de antes de LAU-18 trae `keys`; el de ahora, sólo `creds`. */
type StoredAuthState = {
  creds: AuthenticationCreds;
  keys?: KeyBucket;
};

/** Una clave lista para escribir: categoría, id ya pasado por `idDeFila` y valor ya cifrado. */
type FilaDeClave = { categoria: string; clave: string; valor: string };

export type PrismaAuthState = {
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds: () => Promise<void>;
  /** Se resuelve cuando no queda ningún guardado (creds o claves) en vuelo. */
  esperarGuardados: () => Promise<void>;
};

/**
 * `creds.me.phoneNumber` (formato PN) o, si Baileys sólo tiene el LID,
 * `creds.me.id`, con forma "<número>[:<device>]@dominio"; nos quedamos con
 * el número.
 */
export function extraerTelefono(creds: AuthenticationCreds): string | undefined {
  const crudo = creds.me?.phoneNumber ?? creds.me?.id;
  return crudo?.split('@')[0]?.split(':')[0];
}

/**
 * Hay dos formas de vincular y cada una deja una marca distinta:
 *
 * - QR: `configureSuccessfulPairing` completa `creds.me` al escanear, y
 *   `creds.registered` nunca se toca.
 * - Código: `requestPairingCode` completa `creds.me` con el número tipeado
 *   **antes** de que la persona ingrese el código, y deja `pairingCode`. Recién
 *   cuando WhatsApp lo confirma Baileys pone `creds.registered` en `true`.
 *
 * Por eso `creds.me` solo no alcanza: con un código pendiente diría que ya
 * vinculó, se guardaría `registered: true` y el próximo arranque intentaría
 * reanudar una sesión que no existe.
 */
export function estaVinculado(creds: AuthenticationCreds): boolean {
  return Boolean(creds.me?.id) && (creds.registered || !creds.pairingCode);
}

/**
 * El id con que se guarda una clave. Los de `session` son el JID de cada
 * cliente (su teléfono), que antes viajaba adentro del blob cifrado: en la
 * fila va un HMAC con `TOKEN_ENCRYPTION_KEY`, así la tabla no lista quién le
 * escribió a quién. Baileys siempre pide las claves por id y nunca las
 * enumera, así que alcanza con calcularlo de los dos lados.
 */
export function idDeFila(categoria: string, id: string, claveHex: string): string {
  return createHmac('sha256', Buffer.from(claveHex, 'hex'))
    .update(`whatsapp-clave\n${categoria}\n${id}`)
    .digest('base64url');
}

function cifrar(valor: unknown, clave: string): string {
  return encryptToken(JSON.stringify(valor, BufferJSON.replacer), clave);
}

function descifrar<T>(guardado: string, clave: string): T {
  return JSON.parse(decryptToken(guardado, clave), BufferJSON.reviver) as T;
}

/** Al salir de JSON, 'app-state-sync-key' queda como objeto plano; Baileys espera la clase protobuf real. */
function revivirClave(categoria: string, valor: unknown): unknown {
  return categoria === 'app-state-sync-key'
    ? proto.Message.AppStateSyncKeyData.fromObject(valor as object)
    : valor;
}

function esFkViolada(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { code?: unknown } };
  return code === CODIGO_FK_VIOLADA || code === CODIGO_FK_VIOLADA_PG || meta?.code === CODIGO_FK_VIOLADA_PG;
}

type Transaccion = Prisma.TransactionClient;

/** Upsert en lote: una sentencia por FILAS_POR_LOTE filas, sin importar cuántas sean. */
async function escribirClaves(tx: Transaccion, userId: string, filas: FilaDeClave[]): Promise<void> {
  for (let i = 0; i < filas.length; i += FILAS_POR_LOTE) {
    const lote = filas.slice(i, i + FILAS_POR_LOTE);
    await tx.$executeRaw`
      INSERT INTO "WhatsappClave" ("userId", "categoria", "clave", "valor", "updatedAt")
      SELECT ${userId}, t.categoria, t.clave, t.valor, now()
      FROM unnest(
        ${lote.map((f) => f.categoria)}::text[],
        ${lote.map((f) => f.clave)}::text[],
        ${lote.map((f) => f.valor)}::text[]
      ) AS t(categoria, clave, valor)
      ON CONFLICT ("userId", "categoria", "clave")
      DO UPDATE SET "valor" = EXCLUDED."valor", "updatedAt" = EXCLUDED."updatedAt"`;
  }
}

/** Las claves del blob viejo `{ creds, keys }`, listas para pasar a filas. */
function filasDelBlob(keys: KeyBucket, encryptionKey: string): FilaDeClave[] {
  const filas: FilaDeClave[] = [];
  for (const [categoria, bucket] of Object.entries(keys)) {
    for (const [clave, valor] of Object.entries(bucket ?? {})) {
      if (valor !== null && valor !== undefined) {
        filas.push({ categoria, clave: idDeFila(categoria, clave, encryptionKey), valor: cifrar(valor, encryptionKey) });
      }
    }
  }
  return filas;
}

/**
 * Reemplazo de `useMultiFileAuthState` (que Baileys trae por defecto, basado en
 * archivos) por uno respaldado en Postgres. `creds` va en
 * `WhatsappSession.authState` y cada clave de Signal en su propia fila de
 * `WhatsappClave`, serializada con `BufferJSON` y cifrada con AES-256-GCM,
 * igual que `googleRefreshToken` (ver `auth/token-crypto.ts`), con el id
 * pasado por `idDeFila`.
 *
 * Antes era un solo blob `{ creds, keys }` que se reescribía entero en cada
 * `keys.set`, y Baileys esperaba a que terminara (LAU-18): ahora cada guardado
 * toca sólo lo que cambió. Un blob viejo se parte en filas al cargarlo.
 */
export async function usePrismaAuthState(
  prisma: PrismaService,
  userId: string,
  encryptionKey: string,
): Promise<PrismaAuthState> {
  const fila = await prisma.whatsappSession.findUnique({ where: { userId } });

  let almacenado: StoredAuthState | null = null;
  if (fila) {
    try {
      almacenado = descifrar<StoredAuthState>(fila.authState, encryptionKey);
    } catch {
      // Blob corrupto o TOKEN_ENCRYPTION_KEY rotada: arrancamos de cero, como
      // si el usuario nunca hubiera vinculado. Las claves de esas credenciales
      // ya no sirven y mezcladas con las nuevas confundirían a Baileys.
      almacenado = null;
      await prisma.whatsappClave.deleteMany({ where: { userId } });
    }
  }

  const creds: AuthenticationCreds = almacenado?.creds ?? initAuthCreds();
  let sesionCreada = fila !== null;
  let linkedAt = fila?.linkedAt ?? null;
  const mutex = new Mutex();
  const medidor = new MedidorDeGuardados(userId);

  const datosDeSesion = () => {
    const vinculado = estaVinculado(creds);
    if (vinculado && !linkedAt) linkedAt = new Date();
    return {
      authState: cifrar({ creds }, encryptionKey),
      registered: vinculado,
      phoneNumber: extraerTelefono(creds) ?? null,
      linkedAt,
    };
  };

  if (almacenado?.keys) {
    // Sesión de antes de LAU-18: se parte en filas una sola vez, en la misma
    // transacción que deja el blob sin `keys`. No hace falta volver a vincular.
    const filas = filasDelBlob(almacenado.keys, encryptionKey);
    await prisma.$transaction(async (tx) => {
      await escribirClaves(tx, userId, filas);
      await tx.whatsappSession.update({ where: { userId }, data: { authState: cifrar({ creds }, encryptionKey) } });
    });
    logger.log(`Sesión de WhatsApp de ${userId} pasada a una fila por clave (${filas.length} claves).`);
  }

  /** Mide y guarda; si el usuario ya no existe, avisa y sigue (ver abajo). */
  const guardar = (filas: number, escribir: () => Promise<{ bytes: number; serializarMs: number }>) =>
    mutex.runExclusive(async () => {
      const inicio = performance.now();
      try {
        const { bytes, serializarMs } = await escribir();
        const linea = medidor.registrar(serializarMs, Math.round(performance.now() - inicio - serializarMs), filas, bytes);
        if (linea) logger.log(linea);
      } catch (error) {
        // Si el usuario (o su sesión) dejó de existir, por ejemplo un `prisma
        // migrate reset` con la API levantada o una baja de cuenta, no hay
        // dónde guardar. Propagar el error acá lo rompe adentro de Baileys,
        // que lo arrastra hasta la conexión: mejor avisar y seguir, que el
        // socket ya se va a caer solo.
        if (!esFkViolada(error)) throw error;
        logger.warn(`No se pudo guardar la sesión de WhatsApp: el usuario ${userId} ya no existe.`);
      }
    });

  /** `creds` y lo que se deriva de ellas, en la fila de la sesión. */
  const upsertSesion = async (tx: Transaccion) => {
    const inicio = performance.now();
    const datos = datosDeSesion();
    const serializarMs = Math.round(performance.now() - inicio);
    await tx.whatsappSession.upsert({ where: { userId }, create: { userId, ...datos }, update: datos });
    sesionCreada = true;
    return { bytes: datos.authState.length, serializarMs };
  };

  const saveCreds = () => guardar(1, () => upsertSesion(prisma));

  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const resultado: { [id: string]: SignalDataTypeMap[T] } = {};
      if (ids.length === 0) return resultado;
      const idPorFila = new Map(ids.map((id) => [idDeFila(type, id, encryptionKey), id]));
      const filas = await prisma.whatsappClave.findMany({
        where: { userId, categoria: type, clave: { in: [...idPorFila.keys()] } },
        select: { clave: true, valor: true },
      });
      let ilegibles = 0;
      for (const { clave, valor } of filas) {
        const id = idPorFila.get(clave);
        if (id === undefined) continue;
        try {
          resultado[id] = revivirClave(type, descifrar(valor, encryptionKey)) as SignalDataTypeMap[T];
        } catch {
          // Una clave que no descifra cuenta como ausente: Baileys la regenera o la pide.
          ilegibles += 1;
        }
      }
      if (ilegibles > 0) logger.warn(`${ilegibles} claves de WhatsApp de ${userId} no se pudieron descifrar.`);
      return resultado;
    },

    set: async (data: SignalDataSet) => {
      const aEscribir: FilaDeClave[] = [];
      const aBorrar = new Map<string, string[]>();
      const inicio = performance.now();
      for (const [categoria, bucket] of Object.entries(data)) {
        for (const [id, valor] of Object.entries(bucket ?? {})) {
          const clave = idDeFila(categoria, id, encryptionKey);
          if (valor === null || valor === undefined) {
            aBorrar.set(categoria, [...(aBorrar.get(categoria) ?? []), clave]);
          } else {
            aEscribir.push({ categoria, clave, valor: cifrar(valor, encryptionKey) });
          }
        }
      }
      const serializarMs = Math.round(performance.now() - inicio);
      const filas = aEscribir.length + [...aBorrar.values()].reduce((total, ids) => total + ids.length, 0);
      if (filas === 0) return;

      await guardar(filas, async () => {
        let bytes = aEscribir.reduce((total, f) => total + f.valor.length, 0);
        await prisma.$transaction(async (tx) => {
          // Baileys sube las pre-keys antes del primer `creds.update`: la
          // sesión tiene que existir antes que sus claves.
          if (!sesionCreada) bytes += (await upsertSesion(tx)).bytes;
          await escribirClaves(tx, userId, aEscribir);
          for (const [categoria, ids] of aBorrar) {
            await tx.whatsappClave.deleteMany({ where: { userId, categoria, clave: { in: ids } } });
          }
        });
        return { bytes, serializarMs };
      });
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
    esperarGuardados: () => mutex.waitForUnlock(),
  };
}

/**
 * Pasa la sesión de WhatsApp de `desde` a `hacia` (un alta que escaneó con el
 * número de una cuenta existente, ver `WhatsappService.transferirSesion`):
 * credenciales y claves, en una transacción. Las claves se copian cifradas tal
 * cual: el cifrado no depende del usuario. Borrar la sesión de `desde` se
 * lleva sus claves por cascada.
 */
export async function copiarSesion(prisma: PrismaService, desde: string, hacia: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const origen = await tx.whatsappSession.findUniqueOrThrow({ where: { userId: desde } });
    const datos = {
      authState: origen.authState,
      registered: origen.registered,
      phoneNumber: origen.phoneNumber,
      linkedAt: origen.linkedAt,
    };
    await tx.whatsappSession.upsert({ where: { userId: hacia }, create: { userId: hacia, ...datos }, update: datos });
    await tx.whatsappClave.deleteMany({ where: { userId: hacia } });
    await tx.$executeRaw`
      INSERT INTO "WhatsappClave" ("userId", "categoria", "clave", "valor", "updatedAt")
      SELECT ${hacia}, "categoria", "clave", "valor", now()
      FROM "WhatsappClave" WHERE "userId" = ${desde}`;
    await tx.whatsappSession.deleteMany({ where: { userId: desde } });
  });
}
