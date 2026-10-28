import { API_URL, TIENDA_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, pasarAPro } from './ventas';

/** La tienda y el Mercado Libre falsos (e2e/importacion-stub), como los ve la API dentro de compose. */
const TIENDA = `${TIENDA_URL}/tienda`;
const PUBLICACION_ML = 'https://articulo.mercadolibre.com.ar/MLA-1234567890-termo-de-acero-1-litro-_JM';

test.describe('importación rápida de productos (plan Pro)', () => {
  test('sin el plan Pro se ve el aviso, y la API tampoco deja', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    await page.getByRole('link', { name: /Importar desde un enlace/ }).click();
    await expect(page.getByText('La importación rápida es del plan Pro')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver el plan Pro' })).toHaveAttribute('href', '/plan');

    const res = await context.request.post(`${API_URL}/importacion/extraer`, { data: { urls: [`${TIENDA}/mate`] } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ motivo: 'plan_pro_requerido' });
  });

  test('con el Pro lee una tienda, un listado y Mercado Libre, se revisa y se importa sin duplicar', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await pasarAPro(page);

    await page.goto('/productos/importar-enlace');
    await page
      .getByRole('textbox', { name: 'Pegá los enlaces' })
      .fill([`${TIENDA}/mate`, `${TIENDA}/categoria`, PUBLICACION_ML, `${TIENDA}/sin-precio`, `${TIENDA}/a-la-metadata`].join('\n'));
    await page.getByRole('button', { name: 'Leer enlaces' }).click();

    // El mate viene suelto y en la categoría: va una sola vez.
    await expect(page.getByRole('heading', { name: 'Encontramos 4 productos' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: '1 enlace no se pudo leer' })).toContainText(
      'Ese enlace no se puede leer',
    );
    for (const nombre of ['Mate imperial de calabaza', 'Auriculares inalámbricos', 'Termo de acero 1 litro', 'Taza de cerámica']) {
      await expect(page.getByRole('checkbox', { name: `Importar ${nombre}` })).toBeChecked();
    }

    // La taza no dice su precio: se pregunta cómo se vende y, de stock, frena la importación hasta que se carga.
    await expect(page.getByText('Elegí si es un producto a medida o de stock.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar 4 productos' })).toBeDisabled();
    const taza = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Importar Taza de cerámica' }) });
    await expect(taza.getByText('No encontramos el precio: ¿cómo lo vendés?')).toBeVisible();
    await taza.getByRole('radio', { name: /De stock/ }).check();
    await expect(page.getByText('Falta el precio.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar 4 productos' })).toBeDisabled();
    await taza.getByLabel('Precio', { exact: true }).fill('3.500');

    await page.getByRole('button', { name: 'Importar 4 productos' }).click();
    await expect(page.getByRole('heading', { name: 'Se importaron 4 productos' })).toBeVisible();

    await page.getByRole('button', { name: 'Ver mis productos' }).click();
    const lista = page.getByRole('list', { name: 'Productos' });
    await expect(lista).toContainText('Mate imperial de calabaza');
    await expect(lista).toContainText('Termo de acero 1 litro');
    // Los auriculares estaban en dólares y así quedan.
    await expect(lista.getByRole('listitem').filter({ hasText: 'Auriculares inalámbricos' }).first()).toContainText('US$');

    // Volver a leer el mismo enlace lo marca como que ya está, destildado.
    await page.goto('/productos/importar-enlace');
    await page.getByRole('textbox', { name: 'Pegá los enlaces' }).fill(`${TIENDA}/mate?utm_source=instagram`);
    await page.getByRole('button', { name: 'Leer enlaces' }).click();
    await expect(page.getByText('Ya lo tenés')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Importar Mate imperial de calabaza' })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Importar 0 productos' })).toBeDisabled();
  });

  test('una landing sin precios trae sus modelos, se eligen a medida y se completan en el editor', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await pasarAPro(page);

    await page.goto('/productos/importar-enlace');
    await page.getByRole('textbox', { name: 'Pegá los enlaces' }).fill(`${TIENDA}/landing`);
    await page.getByRole('button', { name: 'Leer enlaces' }).click();
    await expect(page.getByRole('heading', { name: 'Encontramos 2 productos' })).toBeVisible({ timeout: 30_000 });

    // La Retro dice "a medida": viene sugerida así. La Kiev no dice nada: hay que elegir.
    const retro = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Importar Línea Retro' }) });
    const kiev = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Importar Línea Kiev' }) });
    await expect(retro.getByRole('radio', { name: /A medida/ })).toBeChecked();
    await expect(retro.getByLabel('Descripción', { exact: false })).toHaveValue('Tres cuerpos: 190 x 80 x 90 cm\nCotizar a medida');
    await expect(kiev.getByRole('radio', { name: /A medida/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Importar 2 productos' })).toBeDisabled();

    await kiev.getByRole('radio', { name: /A medida/ }).check();
    await kiev.getByLabel(/Materiales/).fill('Pana, chenille');
    await kiev.getByRole('button', { name: 'Agregar versión' }).click();
    await kiev.getByLabel('Nombre de la versión').fill('Tres cuerpos');
    await expect(page.getByText('Falta el precio de Tres cuerpos.').first()).toBeVisible();
    await kiev.getByLabel('Precio de Tres cuerpos').fill('900.000');

    await page.getByRole('button', { name: 'Importar 2 productos' }).click();
    await expect(page.getByRole('heading', { name: 'Se importaron 2 productos' })).toBeVisible();
    await expect(page.getByText('Los productos a medida necesitan sus preguntas')).toBeVisible();

    const fila = page.getByRole('listitem').filter({ hasText: 'Línea Kiev' });
    await fila.getByRole('link', { name: 'Completar configuración' }).click();
    await expect(page.getByRole('heading', { name: 'Editar producto a medida' })).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true }).first()).toHaveValue('Línea Kiev');
  });
});
