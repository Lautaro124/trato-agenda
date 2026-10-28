import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { conectarMercadoPago, crearAgenteVentasPorApi, crearProductoPorApi, llamadasDeMercadoPago } from './ventas';

/** El chat de prueba por API. */
async function decirle(request: APIRequestContext, message: string): Promise<string> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { reply: string }).reply;
}

test.describe('productos en dólares', () => {
  test('se ofrecen en US$ y el pedido se cobra a mano aunque haya Mercado Pago', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await conectarMercadoPago(page);
    await crearProductoPorApi(context.request, {
      codigo: 'AURI-E2E',
      nombre: 'Auriculares bluetooth',
      precioCentavos: 2_500,
      stock: 3,
      moneda: 'USD',
    });

    expect(await decirle(context.request, '¿tenés auriculares bluetooth?')).toContain('Tengo Auriculares bluetooth a US$ 25.');
    const pedido = await decirle(context.request, 'quiero 1, soy Ana');
    expect(pedido).toContain('Pedido creado para "Ana"');
    expect(pedido).toContain('US$ 25');
    expect(pedido).toContain('no va con link de Mercado Pago');

    // Mercado Pago cobra en pesos: ningún link se pidió para este pedido.
    const preferencias = (await llamadasDeMercadoPago(context.request)).filter((llamada) => llamada.tipo === 'preferencia');
    expect(preferencias.some((llamada) => JSON.stringify(llamada).includes('Auriculares bluetooth'))).toBe(false);

    await page.goto('/productos');
    await expect(page.getByRole('list', { name: 'Productos' })).toContainText('US$');
  });
});
