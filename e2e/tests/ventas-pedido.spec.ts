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
    await formulario.getByLabel('Stock (unidades)').fill('10');
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    const tarjetas = page.getByRole('list', { name: 'Productos' }).getByRole('listitem');
    await expect(tarjetas.filter({ hasText: 'Mate de calabaza' }).getByRole('form', { name: 'Precio y stock de Mate de calabaza' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar Mate de calabaza' }).click();
    await expect(page.getByRole('form', { name: 'Editar producto' })).toBeVisible();
  });

  test('un producto a demanda pide el tiempo de entrega en vez del stock', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    const formulario = await nuevoProducto(page);
    await formulario.getByLabel('Código', { exact: true }).fill('MESA-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Mesa de roble');
    await formulario.getByLabel(/^Precio/).first().fill('250.000');
    await formulario.getByRole('radio', { name: 'A demanda' }).check();
    await expect(formulario.getByLabel('Stock (unidades)')).toBeHidden();

    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'en cuántos días lo entregás' })).toBeVisible();
    await formulario.getByLabel(/^Tiempo de entrega/).fill('15');
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    await page.getByRole('button', { name: 'Editar Mesa de roble' }).click();
    const edicion = page.getByRole('form', { name: 'Editar producto' });
    await expect(edicion.getByRole('radio', { name: 'A demanda' })).toBeChecked();
    await expect(edicion.getByLabel(/^Tiempo de entrega/)).toHaveValue('15');
  });
});
