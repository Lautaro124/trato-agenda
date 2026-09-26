import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { VentasController } from './ventas.controller.js';
import type { VentasService } from './ventas.service.js';

const SECRETO = 'secreto-de-prueba';

function firmar(dataId: string) {
  const ts = '1700000000';
  const v1 = createHmac('sha256', SECRETO).update(`id:${dataId};request-id:req-1;ts:${ts};`).digest('hex');
  return { xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1' };
}

function crear() {
  const ventas = {
    procesarPago: vi.fn().mockResolvedValue(null),
    buscarDelDueno: vi.fn(),
    marcarPagada: vi.fn(),
    cancelar: vi.fn(),
  };
  const config = { get: () => SECRETO } as unknown as ConfigService<Env, true>;
  return { controller: new VentasController(ventas as unknown as VentasService, config), ventas };
}

describe('VentasController.webhook', () => {
  it('con firma inválida no toca nada y responde 200', async () => {
    const { controller, ventas } = crear();
    const respuesta = await controller.webhook({ type: 'payment', data: { id: '9' } }, { venta: 'v-1' }, 'ts=1,v1=x', 'req-1');
    expect(respuesta).toEqual({ recibido: false });
    expect(ventas.procesarPago).not.toHaveBeenCalled();
  });

  it('con firma válida procesa el pago con la venta del notification_url', async () => {
    const { controller, ventas } = crear();
    const { xSignature, xRequestId } = firmar('9');
    const respuesta = await controller.webhook({ type: 'payment', data: { id: '9' } }, { venta: 'v-1' }, xSignature, xRequestId);
    expect(respuesta).toEqual({ recibido: true });
    expect(ventas.procesarPago).toHaveBeenCalledWith('9', 'v-1');
  });

  it('ignora lo que no es un pago y nunca propaga un error', async () => {
    const { controller, ventas } = crear();
    const { xSignature, xRequestId } = firmar('9');
    expect(await controller.webhook({ type: 'merchant_order', data: { id: '9' } }, {}, xSignature, xRequestId)).toEqual({
      recibido: true,
    });
    expect(ventas.procesarPago).not.toHaveBeenCalled();

    ventas.procesarPago.mockRejectedValue(new Error('Mercado Pago caído'));
    expect(await controller.webhook({ type: 'payment', data: { id: '9' } }, { venta: 'v-1' }, xSignature, xRequestId)).toEqual({
      recibido: true,
    });
  });
});

describe('VentasController.marcarPagada', () => {
  const DUENO = { id: 'user-1' } as User;

  it('sólo marca pedidos propios sin pagar', async () => {
    const { controller, ventas } = crear();
    ventas.buscarDelDueno.mockResolvedValue({ estado: 'pagada' });
    await expect(controller.marcarPagada(DUENO, 'v-1')).rejects.toMatchObject({ status: 404 });

    ventas.buscarDelDueno.mockResolvedValue(null);
    await expect(controller.marcarPagada(DUENO, 'v-ajena')).rejects.toMatchObject({ status: 404 });
    expect(ventas.marcarPagada).not.toHaveBeenCalled();
  });
});
