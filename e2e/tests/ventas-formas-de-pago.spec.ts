import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, nuevoProducto } from './ventas';

test.describe('formas de pago del asistente de ventas (LAU-34)', () => {
  test('se configuran cuotas y descuento en efectivo en Cuenta y quedan guardados', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    // El paso del Home arranca pendiente y lleva a la sección de Cuenta.
    await page.goto('/inicio');
    const tienda = page.getByRole('region', { name: 'Tu tienda' });
    await expect(tienda.getByText('Definí cuotas y pago en efectivo (pendiente)')).toBeVisible();
    await tienda.getByRole('link', { name: 'Configurar' }).click();
    await page.waitForURL('**/cuenta#formas-de-pago');
    const seccion = page.getByRole('region', { name: 'Formas de pago' });
    await expect(seccion.getByText('No ofrecés pago en cuotas.')).toBeVisible();

    await seccion.getByRole('button', { name: 'Agregar plan de cuotas' }).click();
    await seccion.getByLabel('Cantidad de cuotas').nth(0).fill('6');
    await seccion.getByLabel('Recargo (%)').nth(0).fill('15');
    await seccion.getByRole('button', { name: 'Agregar plan de cuotas' }).click();
    await seccion.getByLabel('Cantidad de cuotas').nth(1).fill('6');
    // Dos planes iguales no se pueden guardar.
    await expect(seccion.getByRole('alert')).toHaveText('Hay dos planes de 6 cuotas: dejá uno.');
    await expect(seccion.getByRole('button', { name: 'Guardar formas de pago' })).toBeDisabled();
    await seccion.getByLabel('Cantidad de cuotas').nth(1).fill('3');
    // El plan nuevo arranca sin interés: avisa cómo se cobra sin Mercado Pago.
    await expect(seccion.getByText(/las cuotas se coordinan por WhatsApp/)).toBeVisible();
    await seccion.getByLabel('Descuento en efectivo (%)').fill('10');
    await seccion.getByRole('button', { name: 'Guardar formas de pago' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: tu asistente ya ofrece estas formas de pago.');

    const res = await context.request.get(`${API_URL}/condiciones-pago`);
    expect(res.ok(), await res.text()).toBe(true);
    expect(await res.json()).toEqual({
      planesCuotas: [
        { cuotas: 3, recargoPorcentaje: 0 },
        { cuotas: 6, recargoPorcentaje: 15 },
      ],
      descuentoEfectivoPorcentaje: 10,
      cobroManual: null,
    });

    // Al volver, la sección muestra lo guardado, ordenado por cuotas.
    await page.reload();
    await expect(seccion.getByLabel('Cantidad de cuotas').nth(0)).toHaveValue('3');
    await expect(seccion.getByLabel('Recargo (%)').nth(1)).toHaveValue('15');
    await expect(seccion.getByLabel('Descuento en efectivo (%)')).toHaveValue('10');

    // Con algo configurado, el paso del Home queda hecho y resume lo que ofrece.
    await page.goto('/inicio');
    await expect(tienda.getByText('Definí cuotas y pago en efectivo (hecho)')).toBeVisible();
    await expect(
      tienda.getByText('Tu asistente ofrece: 3 cuotas sin interés, 6 cuotas con 15% de recargo, 10% off en efectivo.'),
    ).toBeVisible();
  });

  test('el cobro sin link se configura con un alias o con un mensaje propio', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/cuenta#formas-de-pago');
    const seccion = page.getByRole('region', { name: 'Formas de pago' });
    await expect(seccion.getByRole('radio', { name: /Coordinar por el chat/ })).toBeChecked();

    await seccion.getByRole('radio', { name: /Transferencia/ }).check();
    await seccion.getByLabel('Alias o CBU/CVU').fill('abc');
    await seccion.getByLabel('A nombre de').fill('Ana Pérez');
    await expect(seccion.getByRole('alert')).toContainText('El alias tiene que tener de 6 a 20');
    await seccion.getByLabel('Alias o CBU/CVU').fill('Mates.Sur');
    await expect(seccion.getByText(/tu asistente deja de contestar en ese chat/)).toBeVisible();
    await seccion.getByRole('button', { name: 'Guardar formas de pago' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: tu asistente ya ofrece estas formas de pago.');

    let res = await context.request.get(`${API_URL}/condiciones-pago`);
    expect((await res.json()).cobroManual).toEqual({ modo: 'transferencia', alias: 'mates.sur', titular: 'Ana Pérez' });

    await page.reload();
    await expect(seccion.getByRole('radio', { name: /Transferencia/ })).toBeChecked();
    await expect(seccion.getByLabel('Alias o CBU/CVU')).toHaveValue('mates.sur');

    await seccion.getByRole('radio', { name: /Otro canal/ }).check();
    await seccion.getByLabel('Mensaje para el cliente').fill('Te cobramos {total} desde el 11-5555-0000, {nombre}.');
    await seccion.getByRole('button', { name: 'Guardar formas de pago' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: tu asistente ya ofrece estas formas de pago.');
    res = await context.request.get(`${API_URL}/condiciones-pago`);
    expect((await res.json()).cobroManual).toEqual({
      modo: 'otro_canal',
      mensaje: 'Te cobramos {total} desde el 11-5555-0000, {nombre}.',
    });

    // Un dato que no se completa solo lo rechaza también la API.
    const rechazo = await context.request.put(`${API_URL}/condiciones-pago`, {
      data: { planesCuotas: [], descuentoEfectivoPorcentaje: null, cobroManual: { modo: 'otro_canal', mensaje: 'Pagá en {link}' } },
    });
    expect(rechazo.status()).toBe(400);
  });

  test('un producto se limita a menos cuotas desde su editor', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/productos');
    const formulario = await nuevoProducto(page, 'stock');
    await formulario.getByLabel('Código', { exact: true }).fill('HELADERA-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Heladera');
    await formulario.getByLabel(/^Precio/).first().fill('500.000');
    await expect(formulario.getByLabel('Cuotas')).toHaveValue('');
    await formulario.getByLabel('Cuotas').selectOption({ label: 'Hasta 3 cuotas' });
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    const res = await context.request.get(`${API_URL}/productos`);
    expect(res.ok(), await res.text()).toBe(true);
    const { productos } = (await res.json()) as { productos: Array<{ codigo: string; cuotasMax: number | null }> };
    expect(productos.find((producto) => producto.codigo === 'HELADERA-E2E')?.cuotasMax).toBe(3);
  });

  test('la API rechaza condiciones fuera de rango', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const res = await context.request.put(`${API_URL}/condiciones-pago`, {
      data: { planesCuotas: [{ cuotas: 30, recargoPorcentaje: 0 }], descuentoEfectivoPorcentaje: null },
    });
    expect(res.status()).toBe(400);
  });
});
