import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, type ProductoE2E } from './ventas';

/** Una fila por variante; la última tiene un precio que no es un número. */
const PLANILLA = [
  'codigo;nombre;descripcion;categoria;variante;precio;stock',
  'MATE-1;Mate de calabaza;Curado a mano;Mates;;8.000;5',
  'REM-1;Remera;Algodón peinado;Ropa;Talle S;15000;2',
  'REM-1;Remera;Algodón peinado;Ropa;Talle M;15000;',
  'BOMB-1;Bombilla;;Accesorios;;abc;',
].join('\n');

test.describe('catálogo de un comercio', () => {
  test('importa una planilla con vista previa y errores por fila, y edita precio y stock con Guardar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    await expect(page.getByText('Todavía no cargaste productos')).toBeVisible();
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();

    await page.getByLabel('Planilla de productos').setInputFiles({
      name: 'catalogo.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(PLANILLA),
    });

    // Vista previa: nada se escribió todavía.
    const importar = page.getByRole('region', { name: 'Importar productos' });
    await expect(importar).toContainText('catalogo.csv: 2 productos nuevos, 0 actualizados (3 variantes).');
    await expect(importar).toContainText('1 fila con errores');
    await expect(importar).toContainText(/Fila 5: .*precio/i);
    const antes = (await (await context.request.get(`${API_URL}/productos`)).json()) as { total: number };
    expect(antes.total).toBe(0);

    await importar.getByRole('button', { name: 'Importar 2 productos' }).click();
    await expect(importar.getByRole('status')).toContainText('Listo: 2 nuevos y 0 actualizados.');

    const lista = page.getByRole('list', { name: 'Productos' });
    await expect(lista).toContainText('Mate de calabaza');
    await expect(lista).toContainText('Remera');

    // Edición rápida del precio, sin abrir el editor: queda pendiente hasta Guardar.
    const precio = page.getByLabel('Precio de Mate de calabaza');
    // La tarjeta, no la fila de su variante: las dos son listitem y las dos muestran "SKU MATE-1".
    const tarjetaMate = lista
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Editar Mate de calabaza' }) });
    await precio.fill('9500');
    await expect(tarjetaMate).toContainText('Cambios sin guardar');
    await precio.blur();
    const precioEnApi = async () => {
      const listado = (await (await context.request.get(`${API_URL}/productos?q=MATE-1`)).json()) as { productos: ProductoE2E[] };
      return listado.productos[0]?.variantes[0]?.precioCentavos;
    };
    expect(await precioEnApi()).toBe(800_000);

    // Descartar vuelve a lo guardado sin escribir nada.
    await tarjetaMate.getByRole('button', { name: 'Descartar' }).click();
    await expect(precio).toHaveValue('8.000');
    await expect(tarjetaMate).not.toContainText('Cambios sin guardar');
    expect(await precioEnApi()).toBe(800_000);

    await precio.fill('9500');
    await page.getByRole('button', { name: 'Guardar cambios de Mate de calabaza' }).click();
    await expect(tarjetaMate.getByRole('status')).toContainText('Guardado');
    await expect.poll(precioEnApi).toBe(950_000);

    // Enter también guarda.
    await precio.fill('9.800');
    await precio.press('Enter');
    await expect.poll(precioEnApi).toBe(980_000);

    // Stock vacío = sin control de cantidad: la variante se prende y se apaga con un switch,
    // que también espera a Guardar.
    await page.getByRole('button', { name: 'Remera Talle M: hay stock' }).click();
    await expect(page.getByRole('button', { name: 'Remera Talle M: sin stock' })).toBeVisible();
    const disponibleEnApi = async () => {
      const listado = (await (await context.request.get(`${API_URL}/productos?q=REM-1`)).json()) as { productos: ProductoE2E[] };
      return listado.productos[0]?.variantes.find((v) => v.nombre === 'Talle M')?.disponible;
    };
    expect(await disponibleEnApi()).toBe(true);
    await page.getByRole('button', { name: 'Guardar cambios de Remera' }).click();
    await expect.poll(disponibleEnApi).toBe(false);
  });
});
