import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { esIdDeMeta } from './webhook.js';

/** Plazo de cada llamada a la Graph API. */
const PLAZO_GRAPH_MS = 15_000;

/**
 * Un fallo de la Graph API. Lleva el estado HTTP y el código de Meta, nunca
 * el cuerpo: puede traer el número o el texto del mensaje.
 */
export class ErrorDeGraph extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: number | null,
    que: string,
  ) {
    super(`Graph API: ${que} falló (HTTP ${estado}${codigo === null ? '' : `, código ${codigo}`}).`);
  }

  /** El token del comercio ya no sirve (vencido, revocado o sin permisos): hay que volver a conectar. */
  get tokenInvalido(): boolean {
    return this.codigo === 190 || this.estado === 401;
  }
}

/** Un número de la WABA, como lo devuelve `/{waba}/phone_numbers`. */
export type NumeroDeWaba = { id: string; telefono: string | null };

/** Los hosts desde los que la Cloud API sirve los medios de los clientes. */
export function esHostDeMediaDeMeta(url: string): boolean {
  try {
    const { protocol, hostname, port, username, password } = new URL(url);
    if (protocol !== 'https:' || port || username || password) return false;
    return hostname === 'lookaside.fbsbx.com' || hostname.endsWith('.fbsbx.com') || hostname.endsWith('.whatsapp.net');
  } catch {
    return false;
  }
}

function idSeguro(id: string, que: string): string {
  if (!esIdDeMeta(id)) throw new Error(`${que} no es un id de Meta.`);
  return id;
}

/**
 * La Graph API de Meta para WhatsApp: el canje del código de Embedded Signup y
 * lo que hace falta para atender un número (suscribir la app, registrar el
 * número, mandar, bajar medios). Los ids que llegan del navegador o del
 * webhook se validan antes de ir a una URL.
 */
@Injectable()
export class GraphClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get configurado(): boolean {
    return Boolean(this.config.get('META_APP_ID', { infer: true }));
  }

  private base(): string {
    return `${this.config.get('META_GRAPH_URL', { infer: true })}/${this.config.get('META_GRAPH_VERSION', { infer: true })}`;
  }

  private async pedir<T>(que: string, ruta: string, init: RequestInit & { token?: string }): Promise<T> {
    const { token, headers, ...resto } = init;
    const respuesta = await fetch(`${this.base()}${ruta}`, {
      ...resto,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      signal: AbortSignal.timeout(PLAZO_GRAPH_MS),
      redirect: 'error',
    });
    const cuerpo = (await respuesta.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    if (!respuesta.ok) {
      const codigo = typeof cuerpo?.error?.code === 'number' ? cuerpo.error.code : null;
      throw new ErrorDeGraph(respuesta.status, codigo, que);
    }
    return cuerpo as T;
  }

  /**
   * Canjea el código de Embedded Signup por el token de negocio del comercio.
   * Por POST: el secreto de la app no va en una URL. El código vence a los 5 minutos.
   */
  async canjearCodigo(codigo: string): Promise<string> {
    const cuerpo = new URLSearchParams({
      client_id: this.config.get('META_APP_ID', { infer: true }),
      client_secret: this.config.get('META_APP_SECRET', { infer: true }),
      code: codigo,
    });
    const { access_token: token } = await this.pedir<{ access_token?: unknown }>('el canje del código', '/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    if (typeof token !== 'string' || !token) throw new ErrorDeGraph(502, null, 'el canje del código');
    return token;
  }

  /** Los números de la WABA que el token puede ver: así se comprueba lo que mandó el navegador. */
  async numerosDeWaba(wabaId: string, token: string): Promise<NumeroDeWaba[]> {
    const { data } = await this.pedir<{ data?: unknown }>(
      'la lista de números',
      `/${idSeguro(wabaId, 'La WABA')}/phone_numbers?fields=id,display_phone_number`,
      { token },
    );
    return (Array.isArray(data) ? data : []).flatMap((fila: { id?: unknown; display_phone_number?: unknown }) =>
      esIdDeMeta(fila?.id)
        ? [{ id: fila.id, telefono: typeof fila.display_phone_number === 'string' ? fila.display_phone_number : null }]
        : [],
    );
  }

  /** Suscribe la app a los webhooks de la WABA del comercio. */
  async suscribir(wabaId: string, token: string): Promise<void> {
    await this.pedir('la suscripción al webhook', `/${idSeguro(wabaId, 'La WABA')}/subscribed_apps`, { method: 'POST', token });
  }

  /** Deja de recibir los webhooks de esa WABA (al desconectar). */
  async desuscribir(wabaId: string, token: string): Promise<void> {
    await this.pedir('la baja del webhook', `/${idSeguro(wabaId, 'La WABA')}/subscribed_apps`, { method: 'DELETE', token });
  }

  /** Registra el número en la Cloud API con su PIN de verificación en dos pasos. No va con Coexistence. */
  async registrar(phoneNumberId: string, token: string, pin: string): Promise<void> {
    await this.pedir('el registro del número', `/${idSeguro(phoneNumberId, 'El número')}/register`, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
  }

  /** Manda un mensaje y devuelve su id. */
  async enviar(phoneNumberId: string, token: string, mensaje: Record<string, unknown>): Promise<string | null> {
    const respuesta = await this.pedir<{ messages?: { id?: unknown }[] }>(
      'el envío',
      `/${idSeguro(phoneNumberId, 'El número')}/messages`,
      {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...mensaje }),
      },
    );
    const id = respuesta?.messages?.[0]?.id;
    return typeof id === 'string' ? id : null;
  }

  /** Sube una imagen (JPEG ya procesado) y devuelve el id de media para mandarla. */
  async subirImagen(phoneNumberId: string, token: string, imagen: Buffer): Promise<string> {
    const formulario = new FormData();
    formulario.set('messaging_product', 'whatsapp');
    formulario.set('type', 'image/jpeg');
    formulario.set('file', new Blob([new Uint8Array(imagen)], { type: 'image/jpeg' }), 'foto.jpg');
    const { id } = await this.pedir<{ id?: unknown }>('la subida de una imagen', `/${idSeguro(phoneNumberId, 'El número')}/media`, {
      method: 'POST',
      token,
      body: formulario,
    });
    if (typeof id !== 'string') throw new ErrorDeGraph(502, null, 'la subida de una imagen');
    return id;
  }

  /** La URL temporal de un medio que mandó un cliente. */
  async urlDeMedia(mediaId: string, token: string): Promise<{ url: string; bytes: number | null }> {
    const { url, file_size: bytes } = await this.pedir<{ url?: unknown; file_size?: unknown }>(
      'la consulta de un medio',
      `/${idSeguro(mediaId, 'El medio')}`,
      { token },
    );
    if (typeof url !== 'string' || !esHostDeMediaDeMeta(url)) throw new ErrorDeGraph(502, null, 'la consulta de un medio');
    return { url, bytes: typeof bytes === 'number' ? bytes : null };
  }

  /**
   * Baja un medio de Meta con tope de bytes y de tiempo. null si pasa del
   * tope. Sólo desde los hosts de Meta y sin seguir redirecciones.
   */
  async descargar(url: string, token: string, maxBytes: number, plazoMs: number): Promise<Buffer | null> {
    if (!esHostDeMediaDeMeta(url)) throw new Error('El medio no es de un host de Meta.');
    const respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(plazoMs),
      redirect: 'error',
    });
    if (!respuesta.ok || !respuesta.body) throw new ErrorDeGraph(respuesta.status, null, 'la descarga de un medio');
    const declarado = Number(respuesta.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      await respuesta.body.cancel().catch(() => undefined);
      return null;
    }
    const lector = respuesta.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await lector.cancel().catch(() => undefined);
        return null;
      }
      partes.push(value);
    }
    return Buffer.concat(partes);
  }
}
