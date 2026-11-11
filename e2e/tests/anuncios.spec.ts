import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { esperarRuta, expect, telefonoUnico, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

/** No hay WhatsApp real en el stack: el chat se siembra como si el cliente hubiera escrito desde un anuncio. */
async function sembrarChatDesdeAnuncio(request: APIRequestContext, sourceId: string, titulo: string): Promise<void> {
  const res = await request.post(`${API_URL}/auth/dev/chat`, {
    data: {
      telefono: telefonoUnico(),
      nombre: 'Cliente del anuncio',
      mensajes: [{ de: 'cliente', texto: '¡Hola! Quiero más información.' }],
      anuncio: { sourceId, titulo, cuerpo: 'Sillón con envío incluido a todo el país' },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.describe('anuncios de origen (LAU-103)', () => {
  test('el dueño ve el anuncio desde el que le escribieron y le elige el producto', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'RB3', nombre: 'Rinconero brick 3c', precioCentavos: 66_000_000, stock: 3 });
    await sembrarChatDesdeAnuncio(context.request, `ad-${telefonoUnico()}`, 'Rinconero brick 3c');

    await page.goto('/anuncios');
    await esperarRuta(page, '/anuncios');
    await expect(page.getByRole('heading', { name: 'Anuncios', level: 1 })).toBeVisible();

    const tarjeta = page.getByRole('article', { name: 'Anuncio Rinconero brick 3c' });
    await expect(tarjeta.getByText('Falta elegir el producto')).toBeVisible();
    await expect(tarjeta.getByText('1 consulta')).toBeVisible();

    await tarjeta.getByRole('button', { name: 'Elegir producto' }).click();
    await tarjeta.getByLabel('Buscar producto').fill('rinconero');
    await tarjeta.getByRole('button', { name: 'Buscar' }).click();
    await tarjeta.getByRole('list', { name: 'Productos encontrados' }).getByRole('button', { name: /Rinconero brick 3c/ }).click();

    await expect(tarjeta.getByText('Confirmado')).toBeVisible();
    await expect(tarjeta.getByText('Producto: Rinconero brick 3c')).toBeVisible();

    // Queda guardado: al volver a entrar sigue confirmado.
    await page.reload();
    await expect(page.getByRole('article', { name: 'Anuncio Rinconero brick 3c' }).getByText('Confirmado')).toBeVisible();

    await page
      .getByRole('article', { name: 'Anuncio Rinconero brick 3c' })
      .getByRole('button', { name: 'No es de un producto' })
      .click();
    await expect(page.getByRole('article', { name: 'Anuncio Rinconero brick 3c' }).getByText('Sin producto')).toBeVisible();
  });

  test('el dueño carga un anuncio con su ID antes del primer chat y el chat llega ya con el producto', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'RB3', nombre: 'Rinconero brick 3c', precioCentavos: 66_000_000, stock: 3 });
    const idDelAnuncio = `1202${Date.now()}`;

    await page.goto('/anuncios');
    await page.getByRole('button', { name: 'Agregar anuncio' }).click();
    const formulario = page.getByRole('region', { name: 'Agregar anuncio' });
    await formulario.getByLabel('Link o ID del anuncio').fill(idDelAnuncio);
    await formulario.getByLabel('Nombre para reconocerlo (opcional)').fill('Promo rinconero');
    await formulario.getByLabel('Buscar producto').fill('rinconero');
    await formulario.getByRole('button', { name: 'Buscar' }).click();
    await formulario.getByRole('list', { name: 'Productos encontrados' }).getByRole('button', { name: /Rinconero brick 3c/ }).click();
    await formulario.getByRole('button', { name: 'Guardar anuncio' }).click();

    const tarjeta = page.getByRole('article', { name: 'Anuncio Promo rinconero' });
    await expect(tarjeta.getByText('Confirmado')).toBeVisible();
    await expect(tarjeta.getByText(/Todavía sin consultas/)).toBeVisible();

    // El mismo anuncio otra vez no se duplica.
    await page.getByRole('button', { name: 'Agregar anuncio' }).click();
    await formulario.getByLabel('Link o ID del anuncio').fill(idDelAnuncio);
    await formulario.getByLabel('Buscar producto').fill('rinconero');
    await formulario.getByRole('button', { name: 'Buscar' }).click();
    await formulario.getByRole('list', { name: 'Productos encontrados' }).getByRole('button', { name: /Rinconero brick 3c/ }).click();
    await formulario.getByRole('button', { name: 'Guardar anuncio' }).click();
    await expect(formulario.getByRole('alert')).toContainText('ya está en la lista');
    await formulario.getByRole('button', { name: 'Cancelar' }).last().click();

    // Llega un chat desde ese anuncio: queda con el producto que eligió el dueño.
    await sembrarChatDesdeAnuncio(context.request, idDelAnuncio, 'Rinconero brick 3c');
    await page.reload();
    // La siembra no pisa el nombre (el chat real lo reemplaza por el título del anuncio, si lo trae).
    const conConsulta = page.getByRole('article', { name: 'Anuncio Promo rinconero' });
    await expect(conConsulta.getByText('Confirmado')).toBeVisible();
    await expect(conConsulta.getByText('1 consulta')).toBeVisible();
    await expect(conConsulta.getByRole('button', { name: 'Quitar' })).toHaveCount(0);
  });

  test('un anuncio cargado por error se quita', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'SN', nombre: 'Sillón Nube', precioCentavos: 30_000_000, stock: 1 });

    await page.goto('/anuncios');
    await page.getByRole('button', { name: 'Agregar anuncio' }).click();
    const formulario = page.getByRole('region', { name: 'Agregar anuncio' });
    await formulario.getByLabel('Link o ID del anuncio').fill('el del sillón');
    await formulario.getByLabel('Buscar producto').fill('nube');
    await formulario.getByRole('button', { name: 'Buscar' }).click();
    await formulario.getByRole('list', { name: 'Productos encontrados' }).getByRole('button', { name: /Sillón Nube/ }).click();
    await formulario.getByRole('button', { name: 'Guardar anuncio' }).click();
    await expect(formulario.getByRole('alert')).toContainText('Pegá el link del anuncio o su ID');

    await formulario.getByLabel('Link o ID del anuncio').fill('https://fb.me/sillon-nube');
    await formulario.getByRole('button', { name: 'Guardar anuncio' }).click();
    const tarjeta = page.getByRole('article', { name: 'Anuncio https://fb.me/sillon-nube' });
    await expect(tarjeta).toBeVisible();
    await tarjeta.getByRole('button', { name: 'Quitar' }).click();
    await expect(tarjeta).toHaveCount(0);
  });

  test('sin anuncios, explica qué va a aparecer', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await page.goto('/anuncios');
    await expect(page.getByText('Cuando un cliente te escriba desde un anuncio de Facebook o Instagram')).toBeVisible();
  });
});
