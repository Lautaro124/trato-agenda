import { request as crearRequest } from '@playwright/test';
import { API_URL, DEV_PASSWORD } from '../entorno';
import { crearAgentePorApi, emailUnico, esperarRuta, expect, loginDev, test } from './fixtures';

test.describe('login con contraseña (sólo dev)', () => {
  test('/entrar muestra el formulario dev además del botón de Google', async ({ page }) => {
    await page.goto('/entrar');

    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Entrar con contraseña' })).toBeVisible();
  });

  test('una contraseña incorrecta muestra el error y no entra', async ({ page }) => {
    await page.goto('/entrar');

    await page.getByLabel('Email de desarrollo').fill(emailUnico());
    await page.getByLabel('Contraseña de desarrollo').fill('no-es-esta');
    await page.getByRole('button', { name: 'Entrar sin Google' }).click();

    // Next monta un anunciador de rutas con role="alert" vacío: se filtra por texto.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Contraseña incorrecta.');
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('un usuario nuevo entra, cae en /contanos y puede salir', async ({ page }) => {
    const email = emailUnico();
    await page.goto('/entrar');

    await page.getByLabel('Email de desarrollo').fill(email);
    await page.getByLabel('Contraseña de desarrollo').fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Entrar sin Google' }).click();

    await esperarRuta(page, '/contanos');
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole('button', { name: 'Salir' }).click();
    await esperarRuta(page, '/entrar');

    const me = await page.context().request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(401);
  });

  test('un usuario que ya tiene agente entra directo a /inicio', async ({ page }) => {
    const email = emailUnico();
    // Otro contexto de requests: arma el agente sin loguear la página.
    const aparte = await crearRequest.newContext();
    await loginDev(aparte, email);
    await crearAgentePorApi(aparte);
    await aparte.dispose();

    await page.goto('/entrar');
    await page.getByLabel('Email de desarrollo').fill(email);
    await page.getByLabel('Contraseña de desarrollo').fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Entrar sin Google' }).click();

    await esperarRuta(page, '/inicio');
    await expect(page.getByPlaceholder('Escribile al agente…')).toBeVisible();
  });

  test('con sesión viva /entrar redirige solo', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toContain('@trato.local');

    await page.goto('/entrar');

    await esperarRuta(page, '/contanos');
  });
});
