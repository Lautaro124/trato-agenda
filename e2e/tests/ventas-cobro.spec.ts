import { readFile } from 'node:fs/promises';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { conectarMercadoPago, crearAgenteVentasPorApi, crearProductoPorApi, escribirEnChat, productoPorApi } from './ventas';

test.describe('venta con link de Mercado Pago', () => {
  test('el cliente paga el link: la venta queda pagada, avisa y aparece en el histórico', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const producto = await crearProductoPorApi(context.request, {
      codigo: 'MATE-E2E',
      nombre: 'Mate de calabaza',
      descripcion: 'Curado a mano, con virola de alpaca.',
      precioCentavos: 800_000,
      stock: 5,
    });
    await conectarMercadoPago(page);

    // 1. Desde el chat de prueba: busca, arma el pedido y manda el link.
    await page.goto('/inicio');
    await escribirEnChat(page, '¿tenés mate de calabaza?');
    await expect(page.getByText('Tengo Mate de calabaza a $ 8.000.')).toBeVisible();

    await escribirEnChat(page, 'quiero 2, soy Ana');
    const respuesta = page.getByText(/^Listo: Pedido creado para "Ana": 2 × Mate de calabaza/);
    await expect(respuesta).toBeVisible();
    const link = (await respuesta.textContent())?.match(/https?:\/\/\S+/)?.[0];
    expect(link, 'la respuesta trae el link de pago').toBeTruthy();

    // Reservado, no descontado: el stock baja recién cuando se paga.
    expect((await productoPorApi(context.request, producto.id)).variantes[0].stock).toBe(5);

    // 2. El cliente paga en Mercado Pago (el falso aprueba y manda el webhook firmado).
    await page.goto(link!);
    await page.getByRole('button', { name: 'Pagar' }).click();
    await expect(page.getByRole('heading', { name: '¡Pago aprobado!' })).toBeVisible();

    await expect
      .poll(async () => (await productoPorApi(context.request, producto.id)).variantes[0].stock, {
        message: 'el webhook descuenta el stock',
      })
      .toBe(3);

    // 3. La campanita avisa, y el aviso abre el pedido.
    await page.goto('/inicio');
    const campana = page.getByRole('button', { name: /^Notificaciones \(1 sin leer\)$/ });
    await expect(campana).toBeVisible();
    await campana.click();
    await page.getByRole('button', { name: /\[Prueba\] Venta pagada: \$ 16\.000/ }).click();

    await page.waitForURL((url) => url.pathname === '/ventas' && url.searchParams.has('venta'));
    const detalle = page.getByRole('dialog');
    await expect(detalle.getByRole('heading', { name: 'Ana' })).toBeVisible();
    await expect(detalle.getByText('Pagada', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Link de Mercado Pago')).toBeVisible();
    await expect(detalle.getByRole('button', { name: 'Marcar pagada' })).toHaveCount(0);
    await detalle.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page).toHaveURL(/\/ventas$/);

    // 4. En el histórico, los pedidos del chat de prueba no cuentan salvo que se pidan.
    await expect(page.getByText('No hay ventas con estos filtros.')).toBeVisible();
    await page.getByLabel('Incluir pedidos del chat de prueba').check();
    const fila = page.getByRole('list', { name: 'Ventas' }).getByRole('button', { name: /Ana/ });
    await expect(fila).toContainText('Prueba');
    await expect(fila).toContainText('$ 16.000');
    await expect(page.getByRole('region', { name: 'Lo más vendido' })).toContainText('Mate de calabaza');

    // 5. El CSV sale con los mismos filtros.
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
    const csv = await readFile((await descarga.path())!, 'utf8');
    const [encabezado, primera] = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(encabezado).toBe('fecha;estado;cliente;telefono;medio_de_pago;productos;total;pagada_el;operacion_mercado_pago;prueba');
    expect(primera).toContain(';pagada;Ana;;Mercado Pago;2 × Mate de calabaza;$ 16.000;');
    expect(primera.endsWith(';sí')).toBe(true);

    // 6. Y el dueño lo puede preguntar desde el chat de prueba.
    const resumen = await context.request.post(`${API_URL}/conversation/test`, { data: { message: 'cuánto vendí esta semana' } });
    expect(resumen.ok()).toBe(true);
    // El resumen del chat no cuenta los pedidos de prueba, igual que la pantalla.
    expect(((await resumen.json()) as { reply: string }).reply).toContain('cobrado $ 0 en 0 ventas');
  });
});
