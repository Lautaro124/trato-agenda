import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmaDeWebhookValida } from './webhook-signature.js';

const SECRET = 'secreto-de-prueba';

function firmar(dataId: string, requestId: string, ts: string): string {
  const v1 = createHmac('sha256', SECRET)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('firmaDeWebhookValida', () => {
  const base = { secret: SECRET, xRequestId: 'req-1', dataId: 'pre-1' };

  it('acepta la firma que arma Mercado Pago', () => {
    expect(
      firmaDeWebhookValida({ ...base, xSignature: firmar('pre-1', 'req-1', '1757340000') }),
    ).toBe(true);
  });

  it('rechaza una firma de otro preapproval', () => {
    expect(
      firmaDeWebhookValida({ ...base, xSignature: firmar('pre-2', 'req-1', '1757340000') }),
    ).toBe(false);
  });

  it('rechaza cuando falta el secreto, la firma o el id', () => {
    const firma = firmar('pre-1', 'req-1', '1757340000');

    expect(firmaDeWebhookValida({ ...base, secret: '', xSignature: firma })).toBe(false);
    expect(firmaDeWebhookValida({ ...base, xSignature: undefined })).toBe(false);
    expect(firmaDeWebhookValida({ ...base, dataId: undefined, xSignature: firma })).toBe(false);
    expect(firmaDeWebhookValida({ ...base, xSignature: 'ts=1757340000' })).toBe(false);
  });
});
