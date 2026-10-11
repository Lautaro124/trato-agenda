/**
 * Cachés en memoria que Baileys necesita para que el cliente no vea "Esperando
 * el mensaje…" (LAU-18). En memoria como los sockets: sólo con una réplica.
 */
import type { CacheStore, proto } from '@whiskeysockets/baileys';

/** Cuántos mensajes enviados se recuerdan por cuenta para poder reenviarlos. */
export const MAX_MENSAJES_ENVIADOS = 200;
/** Cuánto vive el contador de reintentos de un mensaje (el default de Baileys). */
export const TTL_REINTENTOS_MS = 60 * 60 * 1000;

/**
 * `CacheStore` mínimo con vencimiento, para `msgRetryCounterCache`: Baileys
 * cuenta ahí cuántas veces pidió un reenvío cada mensaje. Sin dependencias
 * nuevas; los vencidos se borran al leerlos y al pasar `MAX_ENTRADAS`.
 */
export class CacheConVencimiento implements CacheStore {
  private static readonly MAX_ENTRADAS = 5000;
  private readonly entradas = new Map<string, { valor: unknown; vence: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  get<T>(clave: string): T | undefined {
    const entrada = this.entradas.get(clave);
    if (!entrada) return undefined;
    if (entrada.vence <= this.ahora()) {
      this.entradas.delete(clave);
      return undefined;
    }
    return entrada.valor as T;
  }

  set<T>(clave: string, valor: T): void {
    this.entradas.delete(clave);
    this.entradas.set(clave, { valor, vence: this.ahora() + this.ttlMs });
    if (this.entradas.size > CacheConVencimiento.MAX_ENTRADAS) this.podar();
  }

  del(clave: string): void {
    this.entradas.delete(clave);
  }

  flushAll(): void {
    this.entradas.clear();
  }

  get tamano(): number {
    return this.entradas.size;
  }

  /** Saca los vencidos y, si sigue lleno, los más viejos (el Map guarda el orden de inserción). */
  private podar(): void {
    const ahora = this.ahora();
    for (const [clave, { vence }] of this.entradas) {
      if (vence <= ahora) this.entradas.delete(clave);
    }
    for (const clave of this.entradas.keys()) {
      if (this.entradas.size <= CacheConVencimiento.MAX_ENTRADAS) break;
      this.entradas.delete(clave);
    }
  }
}

/**
 * Los últimos mensajes que mandó cada cuenta, por id. Es lo que devuelve
 * `getMessage` cuando el teléfono del cliente no pudo descifrar uno y pide
 * que se lo reenviemos; sin esto Baileys no tiene qué reenviar.
 */
export class MensajesEnviados {
  private readonly porCuenta = new Map<string, Map<string, proto.IMessage>>();

  constructor(private readonly maximo = MAX_MENSAJES_ENVIADOS) {}

  guardar(userId: string, id: string | null | undefined, mensaje: proto.IMessage | null | undefined): void {
    if (!id || !mensaje) return;
    let mensajes = this.porCuenta.get(userId);
    if (!mensajes) {
      mensajes = new Map();
      this.porCuenta.set(userId, mensajes);
    }
    mensajes.delete(id);
    mensajes.set(id, mensaje);
    // El Map recorre en orden de inserción: el primero es el más viejo.
    while (mensajes.size > this.maximo) {
      const masViejo = mensajes.keys().next().value;
      if (masViejo === undefined) break;
      mensajes.delete(masViejo);
    }
  }

  buscar(userId: string, id: string | null | undefined): proto.IMessage | undefined {
    if (!id) return undefined;
    return this.porCuenta.get(userId)?.get(id);
  }

  olvidar(userId: string): void {
    this.porCuenta.delete(userId);
  }
}
