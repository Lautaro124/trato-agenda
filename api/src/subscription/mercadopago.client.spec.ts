import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { MercadoPagoClient, MercadoPagoError, MercadoPagoNoAutorizadoError } from './mercadopago.client.js';

function crearCliente(accessToken = 'TEST-token', extra: Record<string, string> = {}): MercadoPagoClient {
  const valores: Record<string, string> = { MERCADOPAGO_ACCESS_TOKEN: accessToken, ...extra };
  const config = { get: (clave: string) => valores[clave] ?? '' } as unknown as ConfigService<Env, true>;

  return new MercadoPagoClient(config);
}

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status });
}

function pedidoEnviado(indice = 0) {
  const [url, init] = vi.mocked(fetch).mock.calls[indice];
  return {
    url: String(url),
    metodo: init?.method,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
  };
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

  describe('ventas de un comercio', () => {
    const PAGO = { id: 123, status: 'approved', external_reference: 'venta-1', transaction_amount: 8000, currency_id: 'ARS' };

    it('crea la preferencia con el token del comercio, vencida con la reserva y sin efectivo', async () => {
      vi.mocked(fetch).mockResolvedValue(respuesta({ id: 'pref-1', init_point: 'https://mp/pagar' }, 201));
      const venceAt = new Date('2026-09-26T20:30:00Z');

      const preferencia = await crearCliente().crearPreferencia('TOKEN-COMERCIO', {
        items: [{ id: 'v-1', title: 'Mate', quantity: 2, unit_price: 8000.5, currency_id: 'ARS' }],
        externalReference: 'venta-1',
        notificationUrl: 'https://api/ventas/webhook?venta=venta-1',
        venceAt,
      });

      expect(preferencia).toEqual({ id: 'pref-1', init_point: 'https://mp/pagar' });
      const pedido = pedidoEnviado();
      expect(pedido.url).toBe('https://api.mercadopago.com/checkout/preferences');
      expect(pedido.headers.Authorization).toBe('Bearer TOKEN-COMERCIO');
      expect(pedido.body).toMatchObject({
        external_reference: 'venta-1',
        notification_url: 'https://api/ventas/webhook?venta=venta-1',
        expires: true,
        expiration_date_to: venceAt.toISOString(),
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      });
    });

    it('usa MERCADOPAGO_BASE_URL (el Mercado Pago falso de los E2E)', async () => {
      vi.mocked(fetch).mockResolvedValue(respuesta(PAGO));
      await crearCliente('x', { MERCADOPAGO_BASE_URL: 'http://mp-stub:4020' }).obtenerPago('TOKEN', '123');
      expect(pedidoEnviado().url).toBe('http://mp-stub:4020/v1/payments/123');
    });

    it('busca los pagos de una venta por external_reference', async () => {
      vi.mocked(fetch).mockResolvedValue(respuesta({ results: [PAGO] }));
      const pagos = await crearCliente().buscarPagos('TOKEN', 'venta-1');
      expect(pagos).toEqual([PAGO]);
      expect(pedidoEnviado().url).toContain('/v1/payments/search?external_reference=venta-1');
    });

    it('un 401 con el token del comercio es MercadoPagoNoAutorizadoError', async () => {
      vi.mocked(fetch).mockResolvedValue(respuesta({ message: 'invalid token' }, 401));
      await expect(crearCliente().obtenerPago('TOKEN-VIEJO', '1')).rejects.toBeInstanceOf(MercadoPagoNoAutorizadoError);
    });

    it('rechaza un pago incompleto', async () => {
      vi.mocked(fetch).mockResolvedValue(respuesta({ id: 1, status: 'approved' }));
      await expect(crearCliente().obtenerPago('TOKEN', '1')).rejects.toBeInstanceOf(MercadoPagoError);
    });
  });

  describe('OAuth', () => {
    const CREDENCIALES = { MERCADOPAGO_CLIENT_ID: 'app-1', MERCADOPAGO_CLIENT_SECRET: 'secreto' };

    it('canjea el código con PKCE, sin Authorization y con las credenciales de la app', async () => {
      vi.mocked(fetch).mockResolvedValue(
        respuesta({ access_token: 'APP_USR-a', refresh_token: 'TG-r', expires_in: 15552000, user_id: 777 }),
      );

      const tokens = await crearCliente('x', CREDENCIALES).canjearCodigo({
        code: 'TG-code',
        redirectUri: 'https://api/mercadopago/callback',
        codeVerifier: 'verificador',
      });

      expect(tokens.user_id).toBe(777);
      const pedido = pedidoEnviado();
      expect(pedido.url).toBe('https://api.mercadopago.com/oauth/token');
      expect(pedido.headers.Authorization).toBeUndefined();
      expect(pedido.body).toEqual({
        client_id: 'app-1',
        client_secret: 'secreto',
        grant_type: 'authorization_code',
        code: 'TG-code',
        redirect_uri: 'https://api/mercadopago/callback',
        code_verifier: 'verificador',
      });
    });

    it('sin credenciales de OAuth no llama a la API', async () => {
      await expect(crearCliente().refrescarToken('TG-r')).rejects.toThrow('MERCADOPAGO_CLIENT_ID');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('un error del canje no repite el cuerpo (puede traer el secreto)', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('{"client_secret":"secreto"}', { status: 400 }));
      await expect(crearCliente('x', CREDENCIALES).refrescarToken('TG-r')).rejects.toThrow(
        'Mercado Pago respondió 400 en /oauth/token',
      );
      await expect(crearCliente('x', CREDENCIALES).refrescarToken('TG-r')).rejects.not.toThrow('secreto');
    });
  });
});
