import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const MERCADOPAGO_URL = 'https://api.mercadopago.com';
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

/** Se lanza cuando Mercado Pago no está configurado o la llamada falla. */
export class MercadoPagoError extends Error {}

/**
 * Wrapper delgado sobre la API de suscripciones (preapproval) de Mercado Pago.
 * Sin SDK, con `fetch` directo y la misma forma que OpenRouterClient: el resto
 * de `api/` tampoco trae clientes HTTP pesados.
 */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Crea la suscripción en estado `pending`: sin card_token, el cobro lo
   * autoriza la persona en la pantalla de Mercado Pago a la que la mandamos
   * con el `init_point` que devuelve esta llamada.
   */
  async crearPreapproval(input: CrearPreapprovalInput): Promise<Preapproval> {
    return this.pedir('/preapproval', {
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
    });
  }

  async obtenerPreapproval(id: string): Promise<Preapproval> {
    return this.pedir(`/preapproval/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async cancelarPreapproval(id: string): Promise<Preapproval> {
    return this.pedir(`/preapproval/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { status: 'cancelled' },
    });
  }

  private async pedir(
    ruta: string,
    opciones: { method: 'GET' | 'POST' | 'PUT'; body?: unknown },
  ): Promise<Preapproval> {
    const accessToken = this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true });
    if (!accessToken) {
      throw new MercadoPagoError(
        'MERCADOPAGO_ACCESS_TOKEN no está configurada. Definila en api/.env (ver README).',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${MERCADOPAGO_URL}${ruta}`, {
        method: opciones.method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
      });

      if (!res.ok) {
        const cuerpo = await res.text().catch(() => '');
        throw new MercadoPagoError(
          `Mercado Pago respondió ${res.status} en ${ruta}: ${cuerpo.slice(0, 500)}`,
        );
      }

      const data = (await res.json()) as Partial<Preapproval>;
      if (!data.id || !data.status) {
        throw new MercadoPagoError(`Mercado Pago devolvió un preapproval sin id o sin status en ${ruta}.`);
      }

      return data as Preapproval;
    } catch (error) {
      if (error instanceof MercadoPagoError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MercadoPagoError(`Mercado Pago no respondió en ${TIMEOUT_MS}ms.`);
      }
      this.logger.error(`Fallo llamando a Mercado Pago (${ruta})`, error as Error);
      throw new MercadoPagoError(`No se pudo llamar a Mercado Pago: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
