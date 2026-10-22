import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { descargar, DescargaError, textoDe } from './fetch-seguro.js';
import { hostsDePrueba } from './hosts-de-prueba.js';

/** Lo que tarda como mucho una llamada a la API de Mercado Libre, y cuánto puede pesar. */
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;
/** Ids por multiget: el máximo que acepta Mercado Libre. */
export const IDS_POR_MULTIGET = 20;

/** Por qué no se pudo usar la API, para el log (nunca para el dueño). */
export type MotivoNoDisponible = 'sin_credenciales' | 'token_rechazado' | 'acceso_denegado' | 'caida';

/** La API no se pudo usar (sin app configurada, token rechazado, caída): el servicio prueba con la página. */
export class MercadoLibreNoDisponibleError extends Error {
  constructor(readonly motivo: MotivoNoDisponible = 'caida') {
    super('La API de Mercado Libre no está disponible.');
    this.name = 'MercadoLibreNoDisponibleError';
  }
}

/**
 * La API pública de Mercado Libre, sólo lectura. Pasa por la misma descarga
 * segura que cualquier página (fetch-seguro.ts): el host es fijo, pero así
 * también tiene topes de tiempo y de tamaño.
 *
 * Mercado Libre pide un token para leer publicaciones. Con
 * MERCADOLIBRE_CLIENT_ID/SECRET se pide uno de aplicación (client
 * credentials) y se guarda en memoria hasta que vence.
 */
@Injectable()
export class MercadoLibreClient {
  private token: { valor: string; venceAt: number } | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get base(): string {
    return this.config.get('MERCADOLIBRE_API_URL', { infer: true });
  }

  private get hosts(): ReadonlySet<string> {
    return hostsDePrueba(this.config.get('IMPORTACION_HOSTS_DE_PRUEBA', { infer: true }));
  }

  private async tokenDeAplicacion(): Promise<string | null> {
    const id = this.config.get('MERCADOLIBRE_CLIENT_ID', { infer: true });
    const secreto = this.config.get('MERCADOLIBRE_CLIENT_SECRET', { infer: true });
    if (!id || !secreto) return null;
    if (this.token && this.token.venceAt > Date.now()) return this.token.valor;
    try {
      const respuesta = await descargar(`${this.base}/oauth/token`, {
        method: 'POST',
        tipos: ['application/json'],
        maxBytes: 64 * 1024,
        timeoutMs: TIMEOUT_MS,
        hostsDePrueba: this.hosts,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secreto }).toString(),
      });
      const datos = JSON.parse(textoDe(respuesta)) as { access_token?: unknown; expires_in?: unknown };
      if (typeof datos.access_token !== 'string') throw new MercadoLibreNoDisponibleError('token_rechazado');
      const segundos = typeof datos.expires_in === 'number' ? datos.expires_in : 3600;
      // Un minuto antes, para no usarlo justo cuando vence.
      this.token = { valor: datos.access_token, venceAt: Date.now() + Math.max(segundos - 60, 60) * 1000 };
      return this.token.valor;
    } catch {
      throw new MercadoLibreNoDisponibleError('token_rechazado');
    }
  }

  /** Un GET a la API. Un 401/403 o una caída es "no disponible"; un 404 vuelve como null. */
  private async pedir(ruta: string): Promise<unknown> {
    const token = await this.tokenDeAplicacion();
    try {
      const respuesta = await descargar(`${this.base}${ruta}`, {
        tipos: ['application/json'],
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
        hostsDePrueba: this.hosts,
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      return JSON.parse(textoDe(respuesta)) as unknown;
    } catch (error) {
      if (error instanceof DescargaError && error.codigo === 'no_encontrada') return null;
      const denegado = error instanceof DescargaError && error.codigo === 'acceso_denegado';
      if (denegado) this.token = null;
      // Sin token, Mercado Libre rechaza casi todo: el motivo real es que falta configurar la app.
      throw new MercadoLibreNoDisponibleError(!denegado ? 'caida' : token ? 'acceso_denegado' : 'sin_credenciales');
    }
  }

  item(id: string): Promise<unknown> {
    return this.pedir(`/items/${encodeURIComponent(id)}`);
  }

  /** La descripción no es imprescindible: si falla, el producto sale igual sin ella. */
  async descripcion(id: string): Promise<unknown> {
    try {
      return await this.pedir(`/items/${encodeURIComponent(id)}/description`);
    } catch {
      return null;
    }
  }

  items(ids: string[]): Promise<unknown> {
    return this.pedir(`/items?ids=${ids.slice(0, IDS_POR_MULTIGET).map(encodeURIComponent).join(',')}`);
  }

  catalogo(id: string): Promise<unknown> {
    return this.pedir(`/products/${encodeURIComponent(id)}`);
  }

  buscar(sitio: string, filtro: { vendedor: string } | { nickname: string } | { busqueda: string }, limite: number): Promise<unknown> {
    const parametros = new URLSearchParams({ limit: String(Math.min(limite, 50)) });
    if ('vendedor' in filtro) parametros.set('seller_id', filtro.vendedor);
    else if ('nickname' in filtro) parametros.set('nickname', filtro.nickname);
    else parametros.set('q', filtro.busqueda);
    return this.pedir(`/sites/${encodeURIComponent(sitio)}/search?${parametros.toString()}`);
  }
}
