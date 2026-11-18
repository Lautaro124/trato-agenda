import { API_URL } from '../entorno';
import { expect, hablarConAgente, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

test.describe('descuentos del asistente de ventas', () => {
  test('el bot informa el precio con descuento y el pedido se cobra con él', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const res = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'MATE-DESC',
        nombre: 'Mate de calabaza',
        precioCentavos: 1_000_000,
        stock: 5,
        descuento: { tipo: 'porcentaje', valor: 20 },
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    expect((await hablarConAgente(context.request, '¿tenés mate de calabaza?')).reply).toContain('Tengo Mate de calabaza a $ 8.000.');
    const pedido = (await hablarConAgente(context.request, 'quiero 2, soy Ana')).reply;
    expect(pedido).toMatch(/Pedido creado para "Ana": 2 × Mate de calabaza \(\$ 16\.000\)/);
    expect(pedido).toMatch(/Total \$ 16\.000 \(ya con los descuentos: ahorra \$ 4\.000\)/);
  });

  test('ofrece los descuentos una vez al mostrar productos y los pasa todos cuando se los piden', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const mate = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'MATE-OFERTA',
        nombre: 'Mate de calabaza',
        precioCentavos: 1_000_000,
        stock: 5,
        descuento: { tipo: 'porcentaje', valor: 20 },
      },
    });
    expect(mate.status(), await mate.text()).toBe(201);
    await crearProductoPorApi(context.request, { codigo: 'TERMO-OFERTA', nombre: 'Termo de acero', categoria: 'Termos', precioCentavos: 4_500_000 });
    const promo = await context.request.post(`${API_URL}/descuentos`, {
      data: { nombre: 'Semana del termo', categoria: 'Termos', tipo: 'porcentaje', valor: 10 },
    });
    expect(promo.status(), await promo.text()).toBe(201);

    const oferta = 'Además tenemos algunos descuentos, si querés te los paso.';
    const primera = (await hablarConAgente(context.request, '¿qué tenés?')).reply;
    expect(primera).toContain('Esto es lo que tengo:');
    expect(primera).toContain(oferta);

    // Una sola vez por charla: la segunda vez que muestra productos ya no insiste.
    const segunda = (await hablarConAgente(context.request, '¿qué productos tenés?')).reply;
    expect(segunda).toContain('Esto es lo que tengo:');
    expect(segunda).not.toContain(oferta);

    const descuentos = (await hablarConAgente(context.request, '¿qué descuentos tienen?')).reply;
    expect(descuentos).toContain('Estos son los descuentos que tenemos:');
    expect(descuentos).toContain('- Promo Semana del termo: 10% off en la categoría Termos');
    expect(descuentos).toContain('- Mate de calabaza: $ 8.000, antes $ 10.000 (20% off; ahorra $ 2.000)');
  });

  test('carga el descuento desde el formulario y la tarjeta muestra el precio final', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'TERMO-DESC', nombre: 'Termo de acero', precioCentavos: 4_500_000, stock: 10 });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Termo de acero' }).click();
    const dialogo = page.getByRole('form', { name: 'Editar producto' });
    await dialogo.getByLabel('Este producto tiene descuento').check();
    await dialogo.getByText('Monto fijo', { exact: true }).click();
    await dialogo.getByLabel('Monto', { exact: true }).fill('5.000');
    await expect(dialogo.getByText('Así lo va a cobrar el asistente')).toBeVisible();
    await expect(dialogo.getByText('$ 40.000', { exact: true })).toBeVisible();
    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const tarjeta = page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Termo de acero' });
    await expect(tarjeta.getByText('$ 5.000 off')).toBeVisible();
    await expect(tarjeta.getByText('Descuento del producto')).toBeVisible();
    await expect(tarjeta.getByText(/^Final \$ 40\.000/)).toBeVisible();
  });

  test('una promo de categoría se aplica en la prueba de búsqueda y se puede pausar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, {
      codigo: 'YERBA-DESC',
      nombre: 'Yerba orgánica',
      categoria: 'Yerbas',
      precioCentavos: 650_000,
    });

    await page.goto('/productos');
    const promos = page.getByRole('region', { name: 'Promociones' });
    await promos.getByRole('button', { name: 'Nueva promoción' }).click();
    const formulario = promos.getByRole('form', { name: 'Nueva promoción' });
    await formulario.getByLabel('Nombre').fill('Semana del mate');
    await formulario.getByLabel('Para').selectOption('Yerbas');
    await formulario.getByLabel('%').fill('10');
    await formulario.getByRole('button', { name: 'Guardar promoción' }).click();
    await expect(promos.getByText('10% off · Categoría: Yerbas · sin vencimiento')).toBeVisible();

    const probar = page.getByRole('region', { name: 'Probar la búsqueda del asistente' });
    await probar.getByLabel('Consulta de prueba').fill('yerba orgánica');
    await probar.getByRole('button', { name: 'Probar' }).click();
    const resultados = probar.getByRole('list', { name: 'Resultados de la prueba' });
    await expect(resultados.getByText('$ 5.850')).toBeVisible();
    await expect(resultados.getByText(/10% off/)).toBeVisible();

    const interruptor = promos.getByRole('button', { name: 'Semana del mate: activa' });
    await interruptor.click();
    await expect(promos.getByRole('button', { name: 'Semana del mate: pausada' })).toHaveAttribute('aria-pressed', 'false');
    await probar.getByRole('button', { name: 'Probar' }).click();
    await expect(resultados.getByText(/\$ 6\.500/)).toBeVisible();
    await expect(resultados.getByText(/10% off/)).toBeHidden();
  });
});
