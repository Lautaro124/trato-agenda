import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import { SubscriptionController } from '../subscription.controller.js';
import type { SubscriptionService } from '../subscription.service.js';

const SECRETO = 'secreto-de-prueba';

function config(): ConfigService<Env, true> {
  return { get: () => SECRETO } as unknown as ConfigService<Env, true>;
}

function firmar(dataId: string, ts = String(Date.now())): string {
  const manifiesto = `id:${dataId.toLowerCase()};request-id:req-1;ts:${ts};`;
  const v1 = createHmac('sha256', SECRETO).update(manifiesto).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

function controlador(sincronizarDesdeMp = vi.fn().mockResolvedValue(undefined)) {
  const servicio = { sincronizarDesdeMp } as unknown as SubscriptionService;
  return { controller: new SubscriptionController(servicio, config()), sincronizarDesdeMp };
}

describe('webhook de Mercado Pago — adversarial (matriz F/G)', () => {
  it('F-015: firma inválida se ignora, responde 200 con recibido:false y no llama al servicio', async () => {
    const { controller, sincronizarDesdeMp } = controlador();

    const respuesta = await controller.webhook(
      { type: 'subscription_preapproval', data: { id: 'abc123' } },
      {},
      'ts=1,v1=firmaInventada',
      'req-1',
    );

    expect(respuesta).toEqual({ recibido: false });
    expect(sincronizarDesdeMp).not.toHaveBeenCalled();
  });

  it('G-004: sin x-signature (no autenticado) responde 200 sin cambiar nada', async () => {
    const { controller, sincronizarDesdeMp } = controlador();

    const respuesta = await controller.webhook({ type: 'subscription_preapproval', data: { id: 'abc123' } }, {}, undefined, undefined);

    expect(respuesta).toEqual({ recibido: false });
    expect(sincronizarDesdeMp).not.toHaveBeenCalled();
  });

  it('tipo de notificación fuera de interés se ignora aunque la firma sea válida', async () => {
    const { controller, sincronizarDesdeMp } = controlador();
    const firma = firmar('abc123');

    const respuesta = await controller.webhook({ type: 'payment', data: { id: 'abc123' } }, {}, firma, 'req-1');

    expect(respuesta).toEqual({ recibido: true });
    expect(sincronizarDesdeMp).not.toHaveBeenCalled();
  });

  it('G-005: el mismo data.id entregado dos veces sincroniza dos veces, pero siempre responde 200 (la idempotencia real vive en subscription.service)', async () => {
    const { controller, sincronizarDesdeMp } = controlador();
    const firma = firmar('abc123');

    const r1 = await controller.webhook({ type: 'subscription_preapproval', data: { id: 'abc123' } }, {}, firma, 'req-1');
    const r2 = await controller.webhook({ type: 'subscription_preapproval', data: { id: 'abc123' } }, {}, firma, 'req-1');

    expect(r1).toEqual({ recibido: true });
    expect(r2).toEqual({ recibido: true });
    expect(sincronizarDesdeMp).toHaveBeenCalledTimes(2);
    expect(sincronizarDesdeMp).toHaveBeenNthCalledWith(1, 'abc123');
    expect(sincronizarDesdeMp).toHaveBeenNthCalledWith(2, 'abc123');
  });

  it('un fallo de sincronizarDesdeMp (ej. Mercado Pago caído) igual responde 200, nunca 5xx', async () => {
    const { controller } = controlador(vi.fn().mockRejectedValue(new Error('Mercado Pago no responde')));
    const firma = firmar('abc123');

    const respuesta = await controller.webhook({ type: 'preapproval', data: { id: 'abc123' } }, {}, firma, 'req-1');

    expect(respuesta).toEqual({ recibido: true });
  });
});
