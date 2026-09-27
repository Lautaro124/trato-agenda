import type { Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';

async function armarAsistenteDeVentas(page: Page): Promise<string> {
  const negocio = `Mates E2E ${sufijo()}`;
  await page.goto('/contanos');
  await page.getByRole('radio', { name: /Vender productos/ }).click();
  await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(negocio);
  await visible(page.getByLabel('¿Cómo se llama tu asistente?')).fill('Sol');
  // La vista previa del saludo usa lo que se escribió.
  await expect(visible(page.getByText(`Hola, soy Sol, el asistente de ${negocio}.`, { exact: false }))).toBeVisible();
  await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
  await esperarRuta(page, '/listo');
  return negocio;
}

test.describe('onboarding de un comercio', () => {
  test('elige vender, arma su asistente y ve el panel de ventas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await armarAsistenteDeVentas(page);

    const agente = (await agenteActual(context.request)) as unknown as { tipoAsistente: string; allowedActions: string[] };
    expect(agente.tipoAsistente).toBe('ventas');
    expect(agente.allowedActions).toEqual(expect.arrayContaining(['buscar_productos', 'crear_pedido']));

    // La navegación de una cuenta de ventas: catálogo y ventas, sin calendario.
    await page.goto('/inicio');
    await expect(page.getByRole('region', { name: 'Tu tienda' })).toBeVisible();
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Productos' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Calendario' })).toHaveCount(0);

    // Lo propio de la agenda no aplica: /reuniones manda al catálogo.
    await page.goto('/reuniones');
    await esperarRuta(page, '/productos');

    // Y una cuenta no cambia de tipo después.
    const res = await context.request.post(`${API_URL}/agents/generate`, {
      data: {
        tipoTitular: 'negocio',
        nombreTitular: 'Otra cosa',
        tipoUso: 'consultorio',
        tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
        horaDesde: '09:00',
        horaHasta: '18:00',
        nombreBot: 'Tati',
      },
    });
    expect(res.status()).toBe(409);
  });

  test('@movil el mismo formulario, en el teléfono', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await armarAsistenteDeVentas(page);

    await page.goto('/inicio');
    const barra = page.getByRole('navigation').last();
    await expect(barra.getByRole('link', { name: 'Productos' })).toBeVisible();
    await expect(barra.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await expect(barra.getByRole('link', { name: 'Calendario' })).toHaveCount(0);
  });
});
