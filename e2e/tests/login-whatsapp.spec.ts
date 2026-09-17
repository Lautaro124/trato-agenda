import { API_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, esperarRuta, expect, loginDev, ponerPassword, telefonoUnico, test } from './fixtures';

test.describe('entrar con número de WhatsApp y contraseña', () => {
  test('una cuenta nueva elige su contraseña, sale y vuelve a entrar con el número', async ({ page, context }) => {
    const telefono = telefonoUnico();
    // Igual que al terminar el alta: una cuenta de WhatsApp sin contraseña va a elegirla.
    const { destino } = await loginDev(context.request, emailUnico(), telefono);
    expect(destino).toBe('/contrasena');

    // Con sesión y sin contraseña, /entrar la manda a elegirla.
    await page.goto('/entrar');
    await esperarRuta(page, '/contrasena');
    await page.getByLabel('Contraseña nueva').fill('mi-clave-segura');
    await page.getByLabel('Repetir contraseña').fill('mi-clave-segura');
    await page.getByRole('button', { name: 'Guardar y seguir' }).click();
    await esperarRuta(page, '/contanos');

    await page.getByRole('button', { name: 'Salir' }).click();
    await esperarRuta(page, '/entrar');

    await page.getByLabel('Número de WhatsApp').fill(`+${telefono.slice(0, 2)} ${telefono.slice(2)}`);
    await page.getByLabel('Contraseña', { exact: true }).fill('mi-clave-segura');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    await esperarRuta(page, '/contanos');
    const me = await context.request.get(`${API_URL}/auth/me`);
    expect(await me.json()).toMatchObject({ phoneNumber: telefono, tienePassword: true, debePonerPassword: false });
  });

  test('una contraseña equivocada muestra el error y no entra', async ({ page, browser }) => {
    const telefono = telefonoUnico();
    const aparte = await browser.newContext();
    await loginDev(aparte.request, emailUnico(), telefono);
    await ponerPassword(aparte.request, 'mi-clave-segura');
    await aparte.close();

    await page.goto('/entrar');
    await page.getByLabel('Número de WhatsApp').fill(telefono);
    await page.getByLabel('Contraseña', { exact: true }).fill('otra-clave');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
      'El número o la contraseña no son correctos.',
    );
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('con agente, entrar lleva directo a /inicio; y /cuenta cambia la contraseña', async ({ page, browser }) => {
    const telefono = telefonoUnico();
    const aparte = await browser.newContext();
    await loginDev(aparte.request, emailUnico(), telefono);
    await ponerPassword(aparte.request, 'mi-clave-segura');
    await crearAgentePorApi(aparte.request);
    await aparte.close();

    await page.goto('/entrar');
    await page.getByLabel('Número de WhatsApp').fill(telefono);
    await page.getByLabel('Contraseña', { exact: true }).fill('mi-clave-segura');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await esperarRuta(page, '/inicio');

    await page.goto('/cuenta');
    const form = page.getByRole('form', { name: 'Cambiar contraseña' });
    await form.getByLabel('Contraseña actual').fill('no-es-esta');
    await form.getByLabel('Contraseña nueva').fill('otra-clave-segura');
    await form.getByLabel('Repetir contraseña').fill('otra-clave-segura');
    await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(form.getByRole('status')).toHaveText('La contraseña actual no es correcta.');

    await form.getByLabel('Contraseña actual').fill('mi-clave-segura');
    await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(form.getByRole('status')).toHaveText('Listo: tu contraseña quedó guardada.');

    const res = await page.context().request.post(`${API_URL}/auth/whatsapp/login`, {
      data: { telefono, password: 'otra-clave-segura' },
    });
    expect(res.status()).toBe(200);
  });

  test('con agente y sin contraseña, /inicio avisa y lleva a elegirla', async ({ page, context }) => {
    await loginDev(context.request, emailUnico(), telefonoUnico());
    await crearAgentePorApi(context.request);

    await page.goto('/inicio');
    await page.getByRole('link', { name: 'Elegir contraseña' }).click();

    await esperarRuta(page, '/contrasena');
  });

  test('una cuenta sin WhatsApp no tiene sección de contraseña', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/cuenta');

    await expect(page.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Contraseña' })).toHaveCount(0);
  });
});
