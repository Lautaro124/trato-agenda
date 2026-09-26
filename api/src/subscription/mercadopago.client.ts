import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MERCADOPAGO_BASE_URL_POR_DEFECTO, type Env } from '../config/env.js';

const TIMEOUT_MS = 15_000;

/** Estados que devuelve Mercado Pago para un preapproval. */
export type PreapprovalStatus = 'pending' | 'authorized' | 'paused' | 'cancelled';

export type Preapproval = {
  id: string;
  status: PreapprovalStatus;
  init_point?: string;
  external_reference?: string;
  next_payment_date?: string;
  last_modified?: string;
};

export type CrearPreapprovalInput = {
  /** Texto que ve la persona en el checkout y en el resumen de Mercado Pago. */
  reason: string;
  /** Nuestro User.id: es lo que nos deja volver del webhook al usuario. */
  externalReference: string;
  payerEmail: string;
  backUrl: string;
  montoPorMes: number;
  moneda: string;
};

/** Preferencia de Checkout Pro: el link de pago de una venta. */
export type Preferencia = { id: string; init_point: string };

export type ItemPreferencia = {
  id: string;
  title: string;
  quantity: number;
  /** En pesos (con decimales), como lo pide Mercado Pago. */
  unit_price: number;
  currency_id: string;
};

export type CrearPreferenciaInput = {
  items: ItemPreferencia[];
  /** Nuestro Venta.id: con esto el pago vuelve a su venta. */
  externalReference: string;
  notificationUrl: string;
  /** El link deja de aceptar pagos a esta hora (la de la reserva). */
  venceAt: Date;
};

/** Lo que usamos de un pago (`GET /v1/payments/:id`). */
export type PagoMp = {
  id: number | string;
  status: string;
  external_reference?: string | null;
  transaction_amount: number;
  currency_id: string;
  collector_id?: number | string;
  date_approved?: string | null;
};

/** Respuesta de `POST /oauth/token` (canje del código o refresh). */
export type TokensOAuth = {
  access_token: string;
  refresh_token: string;
  /** Segundos de vida del access token (180 días en el flujo authorization_code). */
  expires_in: number;
  user_id: number | string;
};

/** Se lanza cuando Mercado Pago no está configurado o la llamada falla. */
export class MercadoPagoError extends Error {}

/** 401/403 con el token de un comercio: la cuenta se desconectó o revocó el permiso. */
export class MercadoPagoNoAutorizadoError extends MercadoPagoError {}

type Pedido = {
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** Token del comercio (OAuth). Sin esto, el de la aplicación; `null` no manda ninguno. */
  token?: string | null;
};

/**
 * Wrapper delgado sobre la API de Mercado Pago. Sin SDK, con `fetch` directo y
 * la misma forma que OpenRouterClient: el resto de `api/` tampoco trae
 * clientes HTTP pesados.
 *
 * Lo usan dos cosas distintas: la suscripción de Trato (preapproval, con el
 * token de la aplicación) y el asistente de ventas de cada comercio
 * (preferencias y pagos, con el token OAuth de ese comercio).
 */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  // --- Suscripción de Trato (token de la aplicación) --------------------------

  /**
   * Crea la suscripción en estado `pending`: sin card_token, el cobro lo
   * autoriza la persona en la pantalla de Mercado Pago a la que la mandamos
   * con el `init_point` que devuelve esta llamada.
   */
  async crearPreapproval(input: CrearPreapprovalInput): Promise<Preapproval> {
    return conId(
      await this.pedir<Preapproval>('/preapproval', {
        method: 'POST',
        body: {
          reason: input.reason,
          external_reference: input.externalReference,
          payer_email: input.payerEmail,
          back_url: input.backUrl,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: input.montoPorMes,
            currency_id: input.moneda,
          },
          status: 'pending',
        },
      }),
      '/preapproval',
    );
  }

  async obtenerPreapproval(id: string): Promise<Preapproval> {
    const ruta = `/preapproval/${encodeURIComponent(id)}`;
    return conId(await this.pedir<Preapproval>(ruta, { method: 'GET' }), ruta);
  }

  async cancelarPreapproval(id: string): Promise<Preapproval> {
    const ruta = `/preapproval/${encodeURIComponent(id)}`;
    return conId(await this.pedir<Preapproval>(ruta, { method: 'PUT', body: { status: 'cancelled' } }), ruta);
  }

  // --- Ventas de un comercio (token OAuth del comercio) -------------------------

  /**
   * Link de pago de Checkout Pro a nombre del comercio. Vence con la reserva, y
   * sin medios en efectivo ni cajero: esos se acreditan días después, cuando
   * la reserva ya se liberó.
   */
  async crearPreferencia(token: string, input: CrearPreferenciaInput): Promise<Preferencia> {
    const preferencia = await this.pedir<Partial<Preferencia>>('/checkout/preferences', {
      method: 'POST',
      token,
      body: {
        items: input.items,
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: input.venceAt.toISOString(),
        binary_mode: true,
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      },
    });
    if (!preferencia.id || !preferencia.init_point) {
      throw new MercadoPagoError('Mercado Pago devolvió una preferencia sin id o sin init_point.');
    }
    return preferencia as Preferencia;
  }

  async obtenerPago(token: string, id: string): Promise<PagoMp> {
    const ruta = `/v1/payments/${encodeURIComponent(id)}`;
    return validarPago(await this.pedir<Partial<PagoMp>>(ruta, { method: 'GET', token }), ruta);
  }

  /** Pagos de una venta (por su external_reference), del más nuevo al más viejo. */
  async buscarPagos(token: string, externalReference: string): Promise<PagoMp[]> {
    const params = new URLSearchParams({
      external_reference: externalReference,
      sort: 'date_created',
      criteria: 'desc',
    });
    const ruta = `/v1/payments/search?${params}`;
    const respuesta = await this.pedir<{ results?: Array<Partial<PagoMp>> }>(ruta, { method: 'GET', token });
    return (respuesta.results ?? []).map((pago) => validarPago(pago, ruta));
  }

  // --- OAuth (credenciales de la aplicación, sin Authorization) -----------------

  canjearCodigo(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokensOAuth> {
    return this.pedirTokens({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
  }

  refrescarToken(refreshToken: string): Promise<TokensOAuth> {
    return this.pedirTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async pedirTokens(datos: Record<string, string>): Promise<TokensOAuth> {
    const clientId = this.config.get('MERCADOPAGO_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('MERCADOPAGO_CLIENT_SECRET', { infer: true });
    if (!clientId || !clientSecret) {
      throw new MercadoPagoError(
        'MERCADOPAGO_CLIENT_ID / MERCADOPAGO_CLIENT_SECRET no están configuradas. Definilas en api/.env (ver README).',
      );
    }
    const tokens = await this.pedir<Partial<TokensOAuth>>('/oauth/token', {
      method: 'POST',
      token: null,
      body: { client_id: clientId, client_secret: clientSecret, ...datos },
    });
    if (!tokens.access_token || !tokens.refresh_token || !tokens.user_id) {
      throw new MercadoPagoError('Mercado Pago devolvió tokens incompletos.');
    }
    return { ...tokens, expires_in: Number(tokens.expires_in ?? 0) } as TokensOAuth;
  }

  // --- Transporte ---------------------------------------------------------------

  private async pedir<T>(ruta: string, opciones: Pedido): Promise<T> {
    const token = opciones.token === undefined ? this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true }) : opciones.token;
    if (opciones.token === undefined && !token) {
      throw new MercadoPagoError(
        'MERCADOPAGO_ACCESS_TOKEN no está configurada. Definila en api/.env (ver README).',
      );
    }
    const baseUrl = this.config.get('MERCADOPAGO_BASE_URL', { infer: true }) || MERCADOPAGO_BASE_URL_POR_DEFECTO;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}${ruta}`, {
        method: opciones.method,
        signal: controller.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
      });

      if (!res.ok) {
        const cuerpo = await res.text().catch(() => '');
        const sinPermiso = Boolean(opciones.token) && (res.status === 401 || res.status === 403);
        const Clase = sinPermiso ? MercadoPagoNoAutorizadoError : MercadoPagoError;
        // El canje de OAuth no repite su cuerpo: puede traer el código o el secreto de vuelta.
        const detalle = ruta === '/oauth/token' ? '' : `: ${cuerpo.slice(0, 500)}`;
        throw new Clase(`Mercado Pago respondió ${res.status} en ${ruta.split('?')[0]}${detalle}`);
      }

      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof MercadoPagoError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MercadoPagoError(`Mercado Pago no respondió en ${TIMEOUT_MS}ms.`);
      }
      this.logger.error(`Fallo llamando a Mercado Pago (${ruta.split('?')[0]})`, error as Error);
      throw new MercadoPagoError(`No se pudo llamar a Mercado Pago: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function conId(preapproval: Partial<Preapproval>, ruta: string): Preapproval {
  if (!preapproval.id || !preapproval.status) {
    throw new MercadoPagoError(`Mercado Pago devolvió un preapproval sin id o sin status en ${ruta}.`);
  }
  return preapproval as Preapproval;
}

function validarPago(pago: Partial<PagoMp>, ruta: string): PagoMp {
  if (pago.id === undefined || !pago.status || typeof pago.transaction_amount !== 'number' || !pago.currency_id) {
    throw new MercadoPagoError(`Mercado Pago devolvió un pago incompleto en ${ruta.split('?')[0]}.`);
  }
  return pago as PagoMp;
}
