import { createHmac } from 'node:crypto';
import { API_URL, MERCADOPAGO_WEBHOOK_SECRET } from '../entorno';
import { expect, test } from './fixtures';

/**
 * G-004/G-005: el webhook de Mercado Pago es la única ruta sin guard de
 * cookie del API — se autentica por HMAC (webhook-signature.ts). Firma un
 * webhook válido con MERCADOPAGO_WEBHOOK_SECRET (fijo en docker-compose.e2e.yml
 * sólo para este stack) y confirma que Mercado Pago real nunca se toca: un
 * dataId inventado no existe ahí, así que sincronizarDesdeMp fallará al pedir
 * el preapproval — lo que igual debe responder 200 (nunca 5xx, para no entrar
 * en el loop de reintentos de Mercado Pago).
 */
function firmar(dataId: string, requestId = 'req-e2e-1'): { xSignature: string; xRequestId: string } {
  const ts = String(Date.now());
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', MERCADOPAGO_WEBHOOK_SECRET).update(manifiesto).digest('hex');
  return { xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId };
}

test.describe('webhook de suscripción', () => {
  test('sin x-signature responde 200 con recibido:false', async ({ context }) => {
    const respuesta = await context.request.post(`${API_URL}/suscripcion/webhook`, {
      data: { type: 'subscription_preapproval', data: { id: 'e2e-dataid-1' } },
    });

    expect(respuesta.status()).toBe(200);
    expect(await respuesta.json()).toEqual({ recibido: false });
  });

  test('con firma inválida responde 200 con recibido:false', async ({ context }) => {
    const respuesta = await context.request.post(`${API_URL}/suscripcion/webhook`, {
      data: { type: 'subscription_preapproval', data: { id: 'e2e-dataid-2' } },
      headers: { 'x-signature': 'ts=1,v1=firmainventada', 'x-request-id': 'req-x' },
    });

    expect(respuesta.status()).toBe(200);
    expect(await respuesta.json()).toEqual({ recibido: false });
  });

  test('con firma válida pero un data.id inexistente en Mercado Pago responde igual 200, nunca 5xx', async ({ context }) => {
    const dataId = 'e2e-dataid-inexistente';
    const { xSignature, xRequestId } = firmar(dataId);

    const respuesta = await context.request.post(`${API_URL}/suscripcion/webhook`, {
      data: { type: 'subscription_preapproval', data: { id: dataId } },
      headers: { 'x-signature': xSignature, 'x-request-id': xRequestId },
    });

    expect(respuesta.status()).toBe(200);
    expect(await respuesta.json()).toEqual({ recibido: true });
  });

  test('el mismo data.id entregado dos veces no rompe nada (siempre 200)', async ({ context }) => {
    const dataId = 'e2e-dataid-repetido';
    for (let intento = 0; intento < 2; intento += 1) {
      const { xSignature, xRequestId } = firmar(dataId, `req-repetido-${intento}`);
      const respuesta = await context.request.post(`${API_URL}/suscripcion/webhook`, {
        data: { type: 'preapproval', data: { id: dataId } },
        headers: { 'x-signature': xSignature, 'x-request-id': xRequestId },
      });
      expect(respuesta.status()).toBe(200);
    }
  });
});
