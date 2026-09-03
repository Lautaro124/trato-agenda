import { Mutex } from 'async-mutex';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { PrismaService } from '../prisma/prisma.service.js';
import { decryptToken, encryptToken } from '../auth/token-crypto.js';

type KeyBucket = { [category: string]: { [id: string]: unknown } };

type StoredAuthState = {
  creds: AuthenticationCreds;
  keys: KeyBucket;
};

export type PrismaAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
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
 * `creds.registered` de Baileys sólo se marca `true` en el flujo de pairing
 * por código telefónico; en el flujo QR que usamos acá nunca se toca. El
 * indicador real de "ya vinculó" es que `creds.me` esté poblado, que es lo
 * que `configureSuccessfulPairing` completa al escanear el QR.
 */
export function estaVinculado(creds: AuthenticationCreds): boolean {
  return Boolean(creds.me?.id);
}

/**
 * Reemplazo de `useMultiFileAuthState` (que Baileys trae por defecto, basado en
 * archivos) por uno respaldado en Postgres: un solo blob `{ creds, keys }`
 * serializado con `BufferJSON` y cifrado entero con AES-256-GCM, igual que
 * `googleRefreshToken` (ver `auth/token-crypto.ts`). Devuelve el mismo shape
 * que `useMultiFileAuthState`, así entra directo en `makeWASocket({ auth: state })`.
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
      almacenado = JSON.parse(
        decryptToken(fila.authState, encryptionKey),
        BufferJSON.reviver,
      ) as StoredAuthState;
    } catch {
      // Blob corrupto o TOKEN_ENCRYPTION_KEY rotada: arrancamos de cero, como
      // si el usuario nunca hubiera vinculado.
      almacenado = null;
    }
  }

  const creds: AuthenticationCreds = almacenado?.creds ?? initAuthCreds();
  const keys: KeyBucket = almacenado?.keys ?? {};

  // Al salir de JSON, 'app-state-sync-key' queda como objeto plano; Baileys
  // espera la clase protobuf real.
  const clavesDeSync = keys['app-state-sync-key'];
  if (clavesDeSync) {
    for (const id of Object.keys(clavesDeSync)) {
      const valor = clavesDeSync[id];
      if (valor) clavesDeSync[id] = proto.Message.AppStateSyncKeyData.fromObject(valor as object);
    }
  }

  let linkedAt = fila?.linkedAt ?? null;
  const mutex = new Mutex();

  const persistir = () =>
    mutex.runExclusive(async () => {
      const vinculado = estaVinculado(creds);
      if (vinculado && !linkedAt) linkedAt = new Date();

      const blob = JSON.stringify({ creds, keys }, BufferJSON.replacer);
      const cifrado = encryptToken(blob, encryptionKey);
      const telefono = extraerTelefono(creds) ?? null;

      await prisma.whatsappSession.upsert({
        where: { userId },
        create: {
          userId,
          authState: cifrado,
          registered: vinculado,
          phoneNumber: telefono,
          linkedAt,
        },
        update: {
          authState: cifrado,
          registered: vinculado,
          phoneNumber: telefono,
          linkedAt,
        },
      });
    });

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const bucket = keys[type];
          const resultado: { [id: string]: SignalDataTypeMap[T] } = {};
          if (!bucket) return resultado;
          for (const id of ids) {
            const valor = bucket[id];
            if (valor !== undefined && valor !== null) {
              resultado[id] = valor as SignalDataTypeMap[T];
            }
          }
          return resultado;
        },
        set: async (data) => {
          for (const categoria of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const bucket = data[categoria];
            if (!bucket) continue;
            keys[categoria] ??= {};
            for (const id of Object.keys(bucket)) {
              const valor = bucket[id as keyof typeof bucket];
              if (valor === null || valor === undefined) {
                delete keys[categoria]![id];
              } else {
                keys[categoria]![id] = valor;
              }
            }
          }
          await persistir();
        },
      },
    },
    saveCreds: persistir,
  };
}
