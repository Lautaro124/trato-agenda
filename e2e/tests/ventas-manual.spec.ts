import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, escribirEnChat, productoPorApi } from './ventas';

/** El chat de prueba por API, para los tests que no prueban la pantalla del chat. */
async function decirle(request: APIRequestContext, message: string): Promise<string> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { reply: string }).reply;
}

test.describe('pedido sin Mercado Pago (cobro a coordinar)', () => {
  test('queda reservado, avisa, y el dueño lo marca pagado desde Ventas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const producto = await crearProductoPorApi(context.request, {
      codigo: 'REM-E2E',
      nombre: 'Remera de algodón',
      precioCentavos: 1_500_000,
      stock: 2,
    });

    await page.goto('/inicio');
    await escribirEnChat(page, '¿tenés remera de algodón?');
    await expect(page.getByText('Tengo Remera de algodón a $ 15.000.')).toBeVisible();
    await escribirEnChat(page, 'quiero 1, soy Beto');
    await expect(page.getByText(/^Listo: Pedido creado para "Beto": 1 × Remera de algodón/)).toBeVisible();
    await expect(page.getByText(/Queda reservado hasta el .* para coordinar el pago/)).toBeVisible();

    // El aviso de "pedido para cobrar" llega a la campanita (se recarga para no esperar el polling).
    await page.reload();
    await page.getByRole('button', { name: /^Notificaciones \(1 sin leer\)$/ }).click();
    await page.getByRole('button', { name: /\[Prueba\] Pedido para cobrar: \$ 15\.000/ }).click();

    const detalle = page.getByRole('dialog');
    await expect(detalle.getByText('Pendiente de pago', { exact: true })).toBeVisible();
    await expect(detalle.getByText('A coordinar con vos')).toBeVisible();

    page.once('dialog', (confirmacion) => void confirmacion.accept());
    await detalle.getByRole('button', { name: 'Marcar pagada' }).click();
    await expect(detalle.getByText('Pagada', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Pagada el')).toBeVisible();
    expect((await productoPorApi(context.request, producto.id)).variantes[0].stock).toBe(1);
  });

  test('el dueño cancela un pedido y la reserva se libera', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'TAZA-E2E', nombre: 'Taza de cerámica', precioCentavos: 700_000, stock: 1 });

    await decirle(context.request, '¿tenés taza de cerámica?');
    expect(await decirle(context.request, 'quiero 1, soy Caro')).toContain('Pedido creado para "Caro"');
    // Con la única unidad reservada, otro pedido no entra.
    expect(await decirle(context.request, 'quiero 1, soy Caro')).toContain(
      'No hay stock suficiente de "Taza de cerámica" para 1 unidad: sin stock.',
    );

    await page.goto('/ventas');
    await page.getByLabel('Incluir pedidos del chat de prueba').check();
    await page.getByRole('list', { name: 'Ventas' }).getByRole('button', { name: /Caro/ }).click();
    page.once('dialog', (confirmacion) => void confirmacion.accept());
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(page.getByRole('dialog').getByText('Cancelada', { exact: true })).toBeVisible();

    // Liberada la reserva, se puede volver a pedir.
    expect(await decirle(context.request, 'quiero 1, soy Caro')).toContain('Pedido creado para "Caro"');
  });

  test('@movil el histórico y el detalle en el teléfono', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'YERBA-E2E', nombre: 'Yerba orgánica', precioCentavos: 650_000, stock: 10 });
    await decirle(context.request, '¿tenés yerba orgánica?');
    await decirle(context.request, 'quiero 3, soy Dani');

    await page.goto('/ventas');
    await page.getByLabel('Incluir pedidos del chat de prueba').check();
    await expect(page.getByRole('region', { name: 'Cobrado por día' })).toBeVisible();
    await page.getByRole('list', { name: 'Ventas' }).getByRole('button', { name: /Dani/ }).click();

    const detalle = page.getByRole('dialog');
    await expect(detalle.getByText('$ 19.500').first()).toBeVisible();
    page.once('dialog', (confirmacion) => void confirmacion.accept());
    await detalle.getByRole('button', { name: 'Marcar pagada' }).click();
    await expect(detalle.getByText('Pagada', { exact: true })).toBeVisible();

    // Sin desborde horizontal: la página entra en el ancho del teléfono.
    const anchos = await page.evaluate(() => ({ documento: document.documentElement.scrollWidth, ventana: window.innerWidth }));
    expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana);
  });
});
