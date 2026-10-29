import { API_URL } from '../entorno';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, type ProductoE2E } from './ventas';
import { crearXlsx } from './xlsx';

/** Sube una planilla desde el input del panel de importación. */
async function subirPlanilla(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel('Planilla de productos').setInputFiles({ name, mimeType: 'text/csv', buffer });
}

/** Una fila por variante; la última tiene un precio que no es un número. */
const PLANILLA = [
  'codigo;nombre;descripcion;categoria;variante;precio;stock',
  'MATE-1;Mate de calabaza;Curado a mano;Mates;;8.000;5',
  'REM-1;Remera;Algodón peinado;Ropa;Talle S;15000;2',
  'REM-1;Remera;Algodón peinado;Ropa;Talle M;15000;',
  'BOMB-1;Bombilla;;Accesorios;;abc;',
].join('\n');

test.describe('catálogo de un comercio', () => {
  test('importa el export de publicaciones de Mercado Libre sin duplicar al volver a subirlo', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/productos');
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();
    const importar = page.getByRole('region', { name: 'Importar productos' });

    // Como el archivo real: Ayuda primero, hojas auxiliares, y en Publicaciones códigos de columna, títulos y ayudas antes de los datos.
    const codigos = ['FAMILY_ID', 'ITEM_ID', 'VARIATION_ID', 'TITLE', 'VARIATIONS', 'QUANTITY', 'PRICE', 'SALE_PRICE', 'CURRENCY_ID', 'STATUS'];
    const titulos = ['Agrupador de variantes', 'Número de publicación', 'Número de variante', 'Título', 'Variantes', 'Stock en tu depósito', 'Precio', 'Precio en promoción', 'Moneda', 'Estado'];
    const buffer = crearXlsx([
      { nombre: 'Ayuda', filas: [[null, 'Modifica tus publicaciones'], [null, 'Publicaciones', null, '¿Ya completaste los datos?']] },
      { nombre: 'dropdown_options_hidden', filas: [['Exento'], ['21 %']] },
      {
        nombre: 'Publicaciones',
        filas: [
          codigos,
          ['Publicaciones', null, null, null, null, 'Información del producto'],
          titulos,
          titulos,
          [null, null, null, null, null, 'Obligatorio', 'Obligatorio', null, 'Obligatorio'],
          [null, null, null, null, null, null, null, 'Los precios en promoción son los precios de venta'],
          ['111', 'MLA1111111111', null, 'Sillón esquinero chenille', 'Gris Liso', 30, 1046354.8, 651794.04, '$', 'Activa'],
          ['222', 'MLA2222222222', null, 'Sofá retro 3 cuerpos', 'Negro', 12, 944818.3, null, '$', 'Activa'],
          ['333', 'MLA3333333333', null, 'Rinconero sin precio', 'Beige', 5, null, null, '$', 'Activa'],
        ],
      },
    ]);
    const subir = () =>
      page.getByLabel('Planilla de productos').setInputFiles({
        name: 'Publicaciones-2026_10_28-13_41.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
      });

    await subir();
    const resumen = importar.getByRole('list', { name: 'Resumen de la planilla' });
    await expect(resumen).toContainText('2nuevos');
    await expect(resumen).toContainText('1con error');
    // El error dice la fila del Excel y la columna con el nombre que usa Mercado Libre.
    await expect(importar).toContainText('Fila 9');
    await expect(importar).toContainText('Precio: Falta el precio');
    await importar.getByRole('button', { name: 'Importar sólo los válidos (2 productos)' }).click();
    await expect(importar.getByRole('status')).toContainText('Listo: 2 nuevos');
    const lista = page.getByRole('list', { name: 'Productos' });
    await expect(lista).toContainText('Sillón esquinero chenille');
    await expect(lista).toContainText('Sofá retro 3 cuerpos');

    // El mismo archivo otra vez: se reconocen por número de publicación y se actualizan, no se duplican.
    await importar.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();
    await subir();
    await expect(resumen).toContainText('0nuevos');
    await expect(resumen).toContainText('2actualizados');
  });

  test('completa a mano en un modal lo que le falta a la planilla', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/productos');
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();
    const importar = page.getByRole('region', { name: 'Importar productos' });

    await subirPlanilla(page, 'incompleta.csv', Buffer.from('codigo;nombre;precio;stock\nTAZA-1;Taza de cerámica;;5\nVASO-1;Vaso;1200;'));
    await expect(importar).toContainText('1con error');
    await importar.getByRole('button', { name: 'Completar 1 fila a mano' }).click();

    const modal = page.getByRole('dialog', { name: 'Completá lo que falta' });
    await expect(modal).toContainText('Taza de cerámica');
    await expect(modal).toContainText('Falta el precio');
    // Sin escribir nada no se puede guardar; con un valor inválido el modal sigue abierto y lo explica.
    await expect(modal.getByRole('button', { name: 'Guardar y revisar' })).toBeDisabled();
    await modal.getByLabel('Precio').fill('mucho');
    await modal.getByRole('button', { name: 'Guardar y revisar' }).click();
    await expect(modal).toContainText('Precio inválido');
    await modal.getByLabel('Precio').fill('2.500');
    await modal.getByRole('button', { name: 'Guardar y revisar' }).click();

    await expect(modal).toBeHidden();
    await expect(importar.getByRole('list', { name: 'Resumen de la planilla' })).toContainText('2nuevos');
    await importar.getByRole('button', { name: 'Importar (2 productos)' }).click();
    await expect(importar.getByRole('status')).toContainText('Listo: 2 nuevos');
    await expect(page.getByRole('list', { name: 'Productos' })).toContainText('Taza de cerámica');
  });

  test('importa un CSV guardado por Excel en Windows-1252 y avisa si falta una columna', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/productos');
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();
    const importar = page.getByRole('region', { name: 'Importar productos' });

    // Sin la columna "precio": un único aviso, no un error por fila.
    await subirPlanilla(page, 'sin-precio.csv', Buffer.from('codigo;nombre\nA-1;Algo'));
    await expect(importar.getByRole('alert')).toContainText('le falta la columna precio');

    // Excel en español guarda "CSV (delimitado por comas)" en Windows-1252: la ñ y las tildes no pueden romperse.
    await subirPlanilla(page, 'excel.csv', Buffer.from('Código;Nombre;Precio;Stock\r\nPAN-1;Pañuelo bordado;1.500,50;3\r\n', 'latin1'));
    await expect(importar.getByRole('list', { name: 'Resumen de la planilla' })).toContainText('1nuevo');
    await importar.getByRole('button', { name: 'Importar (1 producto)' }).click();
    await expect(importar.getByRole('status')).toContainText('Listo: 1 nuevo');
    await expect(page.getByRole('list', { name: 'Productos' })).toContainText('Pañuelo bordado');
  });

  test('importa una planilla con vista previa y errores por fila, y edita precio y stock con Guardar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    await expect(page.getByText('Todavía no cargaste productos')).toBeVisible();
    await page.getByRole('button', { name: 'Importar planilla' }).first().click();

    await subirPlanilla(page, 'catalogo.csv', Buffer.from(PLANILLA));

    // Vista previa: nada se escribió todavía.
    const importar = page.getByRole('region', { name: 'Importar productos' });
    const resumen = importar.getByRole('list', { name: 'Resumen de la planilla' });
    await expect(resumen).toContainText('2nuevos');
    await expect(resumen).toContainText('1con error');
    await expect(importar).toContainText(/Fila 5.*Precio: Precio inválido/);
    const antes = (await (await context.request.get(`${API_URL}/productos`)).json()) as { total: number };
    expect(antes.total).toBe(0);

    await importar.getByRole('button', { name: 'Importar sólo los válidos (2 productos)' }).click();
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
