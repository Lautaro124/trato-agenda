import type { Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, expect, loginDev, test } from './fixtures';

/** Avanza hasta el último paso y lo cierra; devuelve cuántos pasos mostró. */
async function recorrerHastaElFinal(page: Page): Promise<number> {
  const dialogo = page.getByRole('dialog');
  let pasos = 1;
  while (await dialogo.getByRole('button', { name: 'Siguiente' }).isVisible()) {
    await dialogo.getByRole('button', { name: 'Siguiente' }).click();
    pasos++;
  }
  await dialogo.getByRole('button', { name: 'Listo' }).click();
  await expect(dialogo).toBeHidden();
  return pasos;
}

async function tutorialesVistos(page: Page): Promise<string[]> {
  const res = await page.context().request.get(`${API_URL}/auth/me`);
  return ((await res.json()) as { tutorialesVistos: string[] }).tutorialesVistos;
}

test.describe('recorrido guiado', () => {
  test.beforeEach(async ({ context }) => {
    await loginDev(context.request, emailUnico('tutorial'), undefined, { conTutoriales: true });
    await crearAgentePorApi(context.request);
  });

  test('la bienvenida aparece la primera vez y no vuelve después de terminarla', async ({ page }) => {
    await page.goto('/inicio');
    const dialogo = page.getByRole('dialog', { name: 'Te damos la bienvenida a Trato' });
    await expect(dialogo).toBeVisible();

    await dialogo.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('dialog', { name: 'Tus pantallas' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Anterior' }).click();
    await expect(dialogo).toBeVisible();

    expect(await recorrerHastaElFinal(page)).toBeGreaterThan(2);
    await expect.poll(() => tutorialesVistos(page)).toEqual(['inicio']);

    await page.reload();
    await expect(page.getByRole('heading', { name: /^Hola/ })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('cada pantalla tiene el suyo; saltearlo lo marca y el menú lo vuelve a abrir', async ({ page }) => {
    await page.goto('/calendario');
    await expect(page.getByRole('dialog', { name: 'Tu agenda' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(() => tutorialesVistos(page)).toEqual(['calendario']);

    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Ver tutorial' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Tu agenda' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Saltar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Otra pantalla no vista todavía muestra el suyo.
    await page.goto('/reuniones');
    await expect(page.getByRole('dialog', { name: 'Lo que ofrece tu asistente' })).toBeVisible();
  });

  test('en el celular resalta la barra de abajo @movil', async ({ page }) => {
    await page.goto('/inicio');
    const dialogo = page.getByRole('dialog', { name: 'Te damos la bienvenida a Trato' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('dialog', { name: 'Tus pantallas' })).toBeVisible();
    await recorrerHastaElFinal(page);
    await expect.poll(() => tutorialesVistos(page)).toEqual(['inicio']);
  });
});
