import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { MercadoPagoClient, MercadoPagoError } from './mercadopago.client.js';

function crearCliente(accessToken = 'TEST-token'): MercadoPagoClient {
  const config = {
    get: (clave: string) => (clave === 'MERCADOPAGO_ACCESS_TOKEN' ? accessToken : ''),
  } as unknown as ConfigService<Env, true>;

  return new MercadoPagoClient(config);
}

const ENTRADA = {
  reason: 'Trato Agenda — plan mensual',
  externalReference: 'user-1',
  payerEmail: 'dueño@ejemplo.com',
  backUrl: 'http://localhost:3000/plan?volviendo=1',
  montoPorMes: 20000,
  moneda: 'ARS',
};

describe('MercadoPagoClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crea el preapproval mensual con el importe y el external_reference', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'pre-1', status: 'pending', init_point: 'https://mp/checkout' }), {
        status: 201,
      }),
    );

    const preapproval = await crearCliente().crearPreapproval(ENTRADA);

    expect(preapproval.init_point).toBe('https://mp/checkout');
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/preapproval');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer TEST-token');

    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.external_reference).toBe('user-1');
    expect(body.status).toBe('pending');
    expect(body.auto_recurring).toEqual({
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 20000,
      currency_id: 'ARS',
    });
  });

  it('cancelar manda PUT con status cancelled', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'pre-1', status: 'cancelled' }), { status: 200 }),
    );

    await crearCliente().cancelarPreapproval('pre-1');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/preapproval/pre-1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ status: 'cancelled' });
  });

  it('sin access token no llama a la API', async () => {
    await expect(crearCliente('').crearPreapproval(ENTRADA)).rejects.toBeInstanceOf(MercadoPagoError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un 401 de Mercado Pago se convierte en MercadoPagoError', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('invalid token', { status: 401 }));

    await expect(crearCliente().obtenerPreapproval('pre-1')).rejects.toThrow(/401/);
  });

  it('una respuesta sin id se rechaza en vez de devolverse a medias', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: 'authorized' }), { status: 200 }));

    await expect(crearCliente().obtenerPreapproval('pre-1')).rejects.toBeInstanceOf(MercadoPagoError);
  });
});
