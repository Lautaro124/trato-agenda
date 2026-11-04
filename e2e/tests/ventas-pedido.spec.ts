import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, nuevoProducto } from './ventas';

test.describe('alta de productos', () => {
  test('"Nuevo producto" abre directo el formulario, y Editar abre el mismo editor', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    const formulario = await nuevoProducto(page);
    await formulario.getByLabel('Código', { exact: true }).fill('MATE-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Mate de calabaza');
    await formulario.getByLabel(/^Precio/).first().fill('8.000');
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    const tarjetas = page.getByRole('list', { name: 'Productos' }).getByRole('listitem');
    await expect(tarjetas.filter({ hasText: 'Mate de calabaza' }).getByRole('form', { name: 'Precio y stock de Mate de calabaza' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar Mate de calabaza' }).click();
    await expect(page.getByRole('form', { name: 'Editar producto' })).toBeVisible();
  });
});
