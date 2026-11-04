import { TIENDA_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi } from './ventas';

/** La tienda y el Mercado Libre falsos (e2e/importacion-stub), como los ve la API dentro de compose. */
const TIENDA = `${TIENDA_URL}/tienda`;
const PUBLICACION_ML = 'https://articulo.mercadolibre.com.ar/MLA-1234567890-termo-de-acero-1-litro-_JM';

test.describe('importación rápida de productos', () => {
  test('en el mes de prueba lee una tienda, un listado y Mercado Libre, se revisa y se importa sin duplicar', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/productos');
    await page.getByRole('link', { name: 'Importar desde un enlace' }).click();
    await page
      .getByRole('textbox', { name: 'Pegá los enlaces' })
      .fill([`${TIENDA}/mate`, `${TIENDA}/categoria`, PUBLICACION_ML, `${TIENDA}/sin-precio`, `${TIENDA}/a-la-metadata`].join('\n'));
    await page.getByRole('button', { name: 'Leer enlaces' }).click();

    // El mate viene suelto y en la categoría: va una sola vez. Cada variante de una página es un producto.
    await expect(page.getByRole('heading', { name: 'Encontramos 6 productos' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: '1 enlace no se pudo leer' })).toContainText(
      'Ese enlace no se puede leer',
    );
    for (const nombre of [
      'Mate imperial de calabaza',
      'Auriculares inalámbricos – Negro',
      'Auriculares inalámbricos – Blanco',
      'Termo de acero 1 litro – Color: Verde',
      'Termo de acero 1 litro – Color: Negro',
      'Taza de cerámica',
    ]) {
      await expect(page.getByRole('checkbox', { name: `Importar ${nombre}` })).toBeChecked();
    }

    // La taza no dice su precio: frena la importación hasta que se carga.
    const taza = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Importar Taza de cerámica' }) });
    await expect(page.getByText('Falta el precio.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar 6 productos' })).toBeDisabled();
    await taza.getByLabel('Precio de Taza de cerámica', { exact: true }).fill('3.500');

    await page.getByRole('button', { name: 'Importar 6 productos' }).click();
    await expect(page.getByRole('heading', { name: 'Se importaron 6 productos' })).toBeVisible();

    await page.getByRole('button', { name: 'Ver mis productos' }).click();
    const lista = page.getByRole('list', { name: 'Productos' });
    await expect(lista).toContainText('Mate imperial de calabaza');
    await expect(lista).toContainText('Termo de acero 1 litro – Color: Verde');
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

  test('una landing sin precios trae sus modelos y se importan con el precio que carga el dueño', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos/importar-enlace');
    await page.getByRole('textbox', { name: 'Pegá los enlaces' }).fill(`${TIENDA}/landing`);
    await page.getByRole('button', { name: 'Leer enlaces' }).click();
    await expect(page.getByRole('heading', { name: 'Encontramos 2 productos' })).toBeVisible({ timeout: 30_000 });

    const retro = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Importar Línea Retro' }) });
    await expect(retro.getByLabel('Descripción', { exact: false })).toHaveValue('Tres cuerpos: 190 x 80 x 90 cm\nCotizar a medida');
    // Sin precio en la página, nada se importa hasta que el dueño lo carga.
    await expect(page.getByRole('button', { name: 'Importar 2 productos' })).toBeDisabled();
    for (const [nombre, precio] of [
      ['Línea Retro', '850.000'],
      ['Línea Kiev', '900.000'],
    ] as const) {
      const tarjeta = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: `Importar ${nombre}` }) });
      await tarjeta.getByRole('radio', { name: 'Pesos' }).check();
      await tarjeta.getByLabel(`Precio de ${nombre}`, { exact: true }).fill(precio);
    }

    await page.getByRole('button', { name: 'Importar 2 productos' }).click();
    await expect(page.getByRole('heading', { name: 'Se importaron 2 productos' })).toBeVisible();

    const fila = page.getByRole('listitem').filter({ hasText: 'Línea Kiev' });
    await fila.getByRole('link', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar producto' })).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true }).first()).toHaveValue('Línea Kiev');
  });
});
