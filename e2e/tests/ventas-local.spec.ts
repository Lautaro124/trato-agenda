import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, escribirEnChat } from './ventas';

test.describe('local a la calle de un comercio', () => {
  test('lo carga en /cuenta y el asistente contesta dónde queda y si se retira', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/cuenta');
    const seccion = page.getByRole('region', { name: 'Tu local' });
    await seccion.getByRole('radio', { name: 'Sí, tengo local' }).click();
    await seccion.getByLabel('Dirección').fill('Belgrano 100, Rosario');
    await seccion.getByLabel('Link de Google Maps').fill('http://maps.example.com');
    await expect(seccion.getByText('Pegá el link completo, que empiece con https://')).toBeVisible();
    await expect(seccion.getByRole('button', { name: 'Guardar local' })).toBeDisabled();
    await seccion.getByLabel('Link de Google Maps').fill('https://maps.app.goo.gl/abc');

    // Un horario que cierra antes de abrir no se puede guardar.
    await seccion.getByLabel('Lunes: cierra').selectOption('08:00');
    await expect(seccion.getByText('Tiene que cerrar después de abrir.')).toBeVisible();
    await seccion.getByLabel('Lunes: cierra').selectOption('18:00');

    await seccion.getByRole('checkbox', { name: 'Se pueden retirar las compras en el local' }).check();
    await seccion.getByRole('button', { name: 'Guardar local' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: tu asistente ya usa estos datos del local.');

    await page.reload();
    await expect(page.getByRole('region', { name: 'Tu local' }).getByLabel('Dirección')).toHaveValue('Belgrano 100, Rosario');

    await page.goto('/inicio');
    await escribirEnChat(page, '¿Dónde queda el local? ¿Puedo retirar ahí?');
    await expect(page.getByText('Estamos en Belgrano 100, Rosario. Podés retirar tu compra ahí.')).toBeVisible();
  });

  test('sin local, el asistente lo dice claro', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { local: { tieneLocal: false } });

    await page.goto('/inicio');
    await escribirEnChat(page, '¿cuál es la dirección del local?');
    await expect(page.getByText('No tenemos local a la calle: vendemos sólo por acá.')).toBeVisible();
  });
});
