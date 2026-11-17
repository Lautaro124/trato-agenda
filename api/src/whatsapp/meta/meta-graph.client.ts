import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import type { Env } from '../../config/env.js';

/**
 * Versión de la Graph API, fija en el código: cambiarla es revisar los
 * endpoints de abajo, no una configuración.
 */
export const VERSION_GRAPH = 'v26.0';

/** Plazo de cada llamada a Meta. */
const PLAZO_MS = 15_000;

/** Un error de Meta sin el cuerpo: puede traer teléfonos o textos de clientes. */
export class MetaGraphError extends Error {
  constructor(
    readonly operacion: string,
    readonly status: number,
    /** `error.code` de Meta, si vino: sirve para distinguir sin loguear el cuerpo. */
    readonly codigo?: number,
  ) {
    super(`Meta respondió ${status} a ${operacion}${codigo === undefined ? '' : ` (código ${codigo})`}.`);
  }
}

export type NumeroDeWaba = { id: string; telefono: string };

/** Lo que devuelve `GET /{media_id}`: la URL firmada de descarga, que vence en minutos. */
export type MediaDeMeta = { url: string; mimeType: string | null; bytes: number | null };

function aTelefono(display: string): string {
  return display.replace(/\D/g, '');
}

/**
 * Cliente mínimo de la Cloud API de WhatsApp. No loguea nada: los errores
 * salen como MetaGraphError con la operación y el status, nunca con el
 * cuerpo (puede traer teléfonos o mensajes).
 */
@Injectable()
export class MetaGraphClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Si la API tiene la app de Meta configurada; sin ella no se ofrece la conexión oficial. */
  get configurado(): boolean {
    return Boolean(this.config.get('META_APP_ID', { infer: true }));
  }

  private url(ruta: string): string {
    return `${this.config.get('META_GRAPH_URL', { infer: true })}/${VERSION_GRAPH}/${ruta}`;
  }

  private async pedir<T>(operacion: string, ruta: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, headers, ...resto } = init;
    const respuesta = await fetch(this.url(ruta), {
      ...resto,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      signal: AbortSignal.timeout(PLAZO_MS),
      // Una redirección podría llevarse el token a otro host.
      redirect: 'error',
    });
    const cuerpo = (await respuesta.json().catch(() => null)) as (T & { error?: { code?: number } }) | null;
    if (!respuesta.ok || !cuerpo) {
      const codigo = typeof cuerpo?.error?.code === 'number' ? cuerpo.error.code : undefined;
      throw new MetaGraphError(operacion, respuesta.status, codigo);
    }
    return cuerpo;
  }

  private json(cuerpo: unknown): Pick<RequestInit, 'body' | 'headers' | 'method'> {
    return { method: 'POST', body: JSON.stringify(cuerpo), headers: { 'Content-Type': 'application/json' } };
  }

  /** El `code` de Embedded Signup → token de integración del negocio. */
  async canjearCodigo(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.config.get('META_APP_ID', { infer: true }),
      client_secret: this.config.get('META_APP_SECRET', { infer: true }),
      code,
    });
    // El secreto va en el body y no en la URL: así no queda en logs de proxies.
    const { access_token } = await this.pedir<{ access_token?: string }>('canjear el código', 'oauth/access_token', {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!access_token) throw new MetaGraphError('canjear el código', 200);
    return access_token;
  }

  /**
   * El número `phoneNumberId` si es de la WABA `wabaId` y el token la ve.
   * Es la prueba (junto con que Meta lo dé por verificado) de que quien vuelve de Embedded Signup controla ese número:
   * los ids llegan desde el navegador y no se les cree sin esto.
   */
  async numeroDeWaba(token: string, wabaId: string, phoneNumberId: string): Promise<NumeroDeWaba | null> {
    const { data } = await this.pedir<{
      data?: { id?: string; display_phone_number?: string; code_verification_status?: string }[];
    }>(
      'leer los números de la WABA',
      `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,code_verification_status`,
      { token },
    );
    // Sólo un número verificado con su código: cualquiera puede sumar a su
    // propia WABA un número ajeno sin verificarlo, y eso no prueba controlarlo
    // (con él se entraría a la cuenta de Trato del dueño real).
    const numero = data?.find((n) => n.id === phoneNumberId && n.code_verification_status === 'VERIFIED');
    const telefono = numero?.display_phone_number ? aTelefono(numero.display_phone_number) : '';
    return numero && /^\d{8,15}$/.test(telefono) ? { id: phoneNumberId, telefono } : null;
  }

  /** Los webhooks de la WABA llegan a la app de Trato. */
  async suscribirApp(token: string, wabaId: string): Promise<void> {
    await this.pedir('suscribir la app', `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', token });
  }

  async desuscribirApp(token: string, wabaId: string): Promise<void> {
    await this.pedir('desuscribir la app', `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'DELETE', token });
  }

  /**
   * Registra un número nuevo en la Cloud API (no en coexistencia: ése ya
   * está registrado por la app). El PIN de verificación en dos pasos es
   * aleatorio y no se guarda: el dueño lo cambia desde Meta si lo necesita.
   */
  async registrarNumero(token: string, phoneNumberId: string): Promise<void> {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.pedir('registrar el número', `${encodeURIComponent(phoneNumberId)}/register`, {
      ...this.json({ messaging_product: 'whatsapp', pin }),
      token,
    });
  }

  /**
   * En coexistencia, Meta exige pedir la sincronización de contactos e
   * historial dentro de las 24 h del alta. Lo que llega por esos webhooks se
   * descarta: Trato no guarda el historial previo.
   */
  async iniciarSincronizacion(token: string, phoneNumberId: string): Promise<void> {
    for (const sync_type of ['smb_app_state_sync', 'history']) {
      await this.pedir('pedir la sincronización', `${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
        ...this.json({ messaging_product: 'whatsapp', sync_type }),
        token,
      });
    }
  }

  async enviarTexto(token: string, phoneNumberId: string, para: string, texto: string): Promise<void> {
    await this.pedir('mandar un mensaje', `${encodeURIComponent(phoneNumberId)}/messages`, {
      ...this.json({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { body: texto } }),
      token,
    });
  }

  async enviarImagen(token: string, phoneNumberId: string, para: string, jpeg: Buffer, leyenda: string): Promise<void> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/jpeg');
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'foto.jpg');
    const { id } = await this.pedir<{ id?: string }>('subir una imagen', `${encodeURIComponent(phoneNumberId)}/media`, {
      method: 'POST',
      body: form,
      token,
    });
    if (!id) throw new MetaGraphError('subir una imagen', 200);
    await this.pedir('mandar una imagen', `${encodeURIComponent(phoneNumberId)}/messages`, {
      ...this.json({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'image', image: { id, caption: leyenda } }),
      token,
    });
  }

  /** Marca leído el mensaje y muestra "escribiendo…" (Meta lo apaga solo a los 25 s o al contestar). */
  async leidoYEscribiendo(token: string, phoneNumberId: string, messageId: string, escribiendo: boolean): Promise<void> {
    await this.pedir('marcar leído', `${encodeURIComponent(phoneNumberId)}/messages`, {
      ...this.json({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}),
      }),
      token,
    });
  }

  async media(token: string, mediaId: string): Promise<MediaDeMeta> {
    const { url, mime_type, file_size } = await this.pedir<{ url?: string; mime_type?: string; file_size?: number }>(
      'leer un archivo',
      encodeURIComponent(mediaId),
      { token },
    );
    if (!url) throw new MetaGraphError('leer un archivo', 200);
    return { url, mimeType: mime_type ?? null, bytes: typeof file_size === 'number' ? file_size : null };
  }

  /**
   * Baja un archivo de la URL que dio `media`, con tope de bytes y de tiempo.
   * La URL viene de Meta, pero igual se exige https de un host de Meta (o el
   * del stub, que comparte origen con META_GRAPH_URL): el token va en el header.
   */
  async descargar(token: string, url: string, maxBytes: number, plazoMs: number): Promise<Buffer | null> {
    if (!this.urlDeMediaPermitida(url)) throw new MetaGraphError('descargar un archivo', 0);
    const respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(plazoMs),
      redirect: 'error',
    });
    if (!respuesta.ok || !respuesta.body) throw new MetaGraphError('descargar un archivo', respuesta.status);
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
      if (done) return Buffer.concat(partes);
      total += value.length;
      if (total > maxBytes) {
        await lector.cancel().catch(() => undefined);
        return null;
      }
      partes.push(value);
    }
  }

  private urlDeMediaPermitida(texto: string): boolean {
    try {
      const url = new URL(texto);
      if (url.username || url.password) return false;
      if (url.origin === new URL(this.config.get('META_GRAPH_URL', { infer: true })).origin) return true;
      return url.protocol === 'https:' && !url.port && (url.hostname === 'lookaside.fbsbx.com' || url.hostname.endsWith('.fbcdn.net') || url.hostname.endsWith('.whatsapp.net'));
    } catch {
      return false;
    }
  }
}
