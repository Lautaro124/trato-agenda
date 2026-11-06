import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, nuevoProducto } from './ventas';

test.describe('formas de pago del asistente de ventas (LAU-34)', () => {
  test('el descuento en efectivo se configura en Productos y queda guardado', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await context.request.post(`${API_URL}/productos`, {
      data: { codigo: 'MATE-E2E', nombre: 'Mate', precioCentavos: 100_000 },
    });

    // El paso del Home arranca pendiente y lleva a Productos.
    await page.goto('/inicio');
    const tienda = page.getByRole('region', { name: 'Tu tienda' });
    await expect(tienda.getByText('Definí el pago en efectivo (pendiente)')).toBeVisible();
    await tienda.getByRole('link', { name: 'Configurar' }).click();
    await page.waitForURL('**/productos');
    const grupo = page.getByRole('region', { name: 'Promociones' }).getByRole('group', { name: 'Descuento en efectivo' });

    await grupo.getByLabel('Descuento en efectivo (%)').fill('10');
    await grupo.getByRole('button', { name: 'Guardar descuento' }).click();
    await expect(grupo.getByRole('status')).toHaveText('Listo: tu asistente ya ofrece este descuento.');

    const res = await context.request.get(`${API_URL}/condiciones-pago`);
    expect(res.ok(), await res.text()).toBe(true);
    expect(await res.json()).toEqual({ descuentoEfectivoPorcentaje: 10, cobroManual: null });

    await page.reload();
    await expect(grupo.getByLabel('Descuento en efectivo (%)')).toHaveValue('10');

    await page.goto('/inicio');
    await expect(tienda.getByText('Definí el pago en efectivo (hecho)')).toBeVisible();
    await expect(tienda.getByText('Tu asistente ofrece: 10% off en efectivo.')).toBeVisible();
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

    // Guardar el cobro no pisa el descuento en efectivo, y al revés.
    await context.request.put(`${API_URL}/condiciones-pago`, { data: { descuentoEfectivoPorcentaje: 15 } });
    res = await context.request.get(`${API_URL}/condiciones-pago`);
    expect(await res.json()).toMatchObject({ descuentoEfectivoPorcentaje: 15, cobroManual: { modo: 'otro_canal' } });

    // Un dato que no se completa solo lo rechaza también la API.
    const rechazo = await context.request.put(`${API_URL}/condiciones-pago`, {
      data: { descuentoEfectivoPorcentaje: null, cobroManual: { modo: 'otro_canal', mensaje: 'Pagá en {link}' } },
    });
    expect(rechazo.status()).toBe(400);
  });

  test('cada producto define sus cuotas: un % de recargo o un precio por cuota', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    type ConCuotas = { codigo: string; cuotas: unknown };
    const cuotasDe = async (codigo: string) => {
      const res = await context.request.get(`${API_URL}/productos`);
      expect(res.ok(), await res.text()).toBe(true);
      const { productos } = (await res.json()) as { productos: ConCuotas[] };
      return productos.find((producto) => producto.codigo === codigo)?.cuotas;
    };

    // Con recargo: al prender las cuotas arranca en 3 y el dueño suma las que marca.
    await page.goto('/productos');
    let formulario = await nuevoProducto(page);
    await formulario.getByLabel('Código', { exact: true }).fill('HELADERA-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Heladera');
    await formulario.getByLabel(/^Precio/).first().fill('500.000');
    await formulario.getByLabel('Stock (unidades)').fill('10');
    await expect(formulario.getByRole('switch', { name: 'Ofrecer cuotas' })).not.toBeChecked();
    await formulario.getByRole('switch', { name: 'Ofrecer cuotas' }).check();
    await expect(formulario.getByRole('button', { name: '3 cuotas', pressed: true, exact: true })).toBeVisible();
    await formulario.getByRole('button', { name: '6 cuotas', exact: true }).click();
    await formulario.getByLabel('Recargo (%)').fill('10');
    await expect(formulario.getByText('3 cuotas de $ 183.333')).toBeVisible();
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);
    expect(await cuotasDe('HELADERA-E2E')).toEqual({ modo: 'recargo', recargoPorcentaje: 10, planes: [3, 6] });

    // Con precio por cuota: el total no puede quedar por debajo del precio.
    formulario = await nuevoProducto(page);
    await formulario.getByLabel('Código', { exact: true }).fill('LAVARROPAS-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Lavarropas');
    await formulario.getByLabel(/^Precio/).first().fill('400.000');
    await formulario.getByLabel('Stock (unidades)').fill('10');
    await formulario.getByRole('switch', { name: 'Ofrecer cuotas' }).check();
    await formulario.getByRole('button', { name: '3 cuotas', pressed: true, exact: true }).click();
    await formulario.getByLabel('Otra cantidad').fill('12');
    await formulario.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(formulario.getByRole('button', { name: '12 cuotas', pressed: true, exact: true })).toBeVisible();
    await formulario.getByText('Un precio por cuota', { exact: true }).click();
    await formulario.getByLabel('Total en 12 cuotas').fill('300.000');
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(formulario.getByText(/El total en 12 cuotas no puede ser menor que el precio/)).toBeVisible();
    await formulario.getByLabel('Total en 12 cuotas').fill('520.000');
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);
    expect(await cuotasDe('LAVARROPAS-E2E')).toEqual({ modo: 'precios', planes: [{ cuotas: 12, totalCentavos: 52_000_000 }] });

    // Al volver a editarlo, se ve lo guardado.
    await page.getByRole('button', { name: 'Editar Lavarropas' }).click();
    await expect(page.getByRole('switch', { name: 'Ofrecer cuotas' })).toBeChecked();
    await expect(page.getByRole('button', { name: '12 cuotas', pressed: true, exact: true })).toBeVisible();
    await expect(page.getByLabel('Total en 12 cuotas')).toHaveValue('520.000');
  });

  test('la API rechaza condiciones y cuotas fuera de rango', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const condiciones = await context.request.put(`${API_URL}/condiciones-pago`, {
      data: { descuentoEfectivoPorcentaje: 95 },
    });
    expect(condiciones.status()).toBe(400);
    const producto = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'CUOTAS-MAL',
        nombre: 'Silla',
        precioCentavos: 100_000,
        cuotas: { modo: 'recargo', recargoPorcentaje: 0, planes: [30] },
      },
    });
    expect(producto.status()).toBe(400);
  });
});
