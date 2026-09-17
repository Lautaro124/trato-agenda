import { request as crearRequest, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import {
  crearAgentePorApi,
  emailUnico,
  esperarRuta,
  expect,
  loginDev,
  nacional,
  ponerPassword,
  telefonoUnico,
  test,
} from './fixtures';

/** El código se genera en segundo plano: se espera a que aparezca. */
async function ultimoCodigo(request: APIRequestContext, telefono: string): Promise<string> {
  let codigo: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/auth/dev/ultimo-codigo?telefono=${telefono}`);
        codigo = ((await res.json()) as { codigo: string | null }).codigo;
        return codigo;
      },
      { timeout: 10_000 },
    )
    .toMatch(/^\d{6}$/);
  return codigo!;
}

/** Cuenta tipo WhatsApp con agente y contraseña, armada en otro contexto: la página arranca sin sesión. */
async function cuentaDeWhatsapp(password = 'clave-vieja-123'): Promise<string> {
  const telefono = telefonoUnico();
  const aparte = await crearRequest.newContext();
  await loginDev(aparte, emailUnico(), telefono);
  await ponerPassword(aparte, password);
  await crearAgentePorApi(aparte);
  await aparte.dispose();
  return telefono;
}

test.describe('recuperar la contraseña con un código al chat propio', () => {
  test('pide el código, elige una contraseña nueva y entra; la vieja deja de servir', async ({ page }) => {
    const telefono = await cuentaDeWhatsapp('clave-vieja-123');

    await page.goto('/entrar');
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
    await esperarRuta(page, '/entrar/codigo');

    await page.getByLabel('Número de WhatsApp').fill(nacional(telefono));
    await page.getByRole('button', { name: 'Mandarme el código' }).click();
    await expect(page.getByRole('heading', { name: 'Revisá tu WhatsApp' })).toBeVisible();

    const codigo = await ultimoCodigo(page.context().request, telefono);
    await page.getByLabel('Código de 6 dígitos').fill(codigo);
    await page.getByLabel('Contraseña nueva').fill('clave-nueva-456');
    await page.getByLabel('Repetir contraseña').fill('clave-nueva-456');
    await page.getByRole('button', { name: 'Guardar y entrar' }).click();

    await esperarRuta(page, '/inicio');

    const vieja = await page.context().request.post(`${API_URL}/auth/whatsapp/login`, {
      data: { telefono, password: 'clave-vieja-123' },
    });
    expect(vieja.status()).toBe(401);
    const nueva = await page.context().request.post(`${API_URL}/auth/whatsapp/login`, {
      data: { telefono, password: 'clave-nueva-456' },
    });
    expect(nueva.status()).toBe(200);
  });

  test('un código equivocado muestra el error y no entra', async ({ page }) => {
    const telefono = await cuentaDeWhatsapp();

    await page.goto('/entrar/codigo');
    await page.getByLabel('Número de WhatsApp').fill(nacional(telefono));
    await page.getByRole('button', { name: 'Mandarme el código' }).click();
    const correcto = await ultimoCodigo(page.context().request, telefono);

    await page.getByLabel('Código de 6 dígitos').fill(correcto === '000000' ? '111111' : '000000');
    await page.getByLabel('Contraseña nueva').fill('clave-nueva-456');
    await page.getByLabel('Repetir contraseña').fill('clave-nueva-456');
    await page.getByRole('button', { name: 'Guardar y entrar' }).click();

    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('El código no es válido o venció.');
    await expect(page).toHaveURL(/\/entrar\/codigo$/);
  });

  test('si las contraseñas no coinciden no manda nada', async ({ page }) => {
    const telefono = await cuentaDeWhatsapp();

    await page.goto('/entrar/codigo');
    await page.getByLabel('Número de WhatsApp').fill(nacional(telefono));
    await page.getByRole('button', { name: 'Mandarme el código' }).click();
    const codigo = await ultimoCodigo(page.context().request, telefono);

    await page.getByLabel('Código de 6 dígitos').fill(codigo);
    await page.getByLabel('Contraseña nueva').fill('clave-nueva-456');
    await page.getByLabel('Repetir contraseña').fill('otra-cosa-789');
    await page.getByRole('button', { name: 'Guardar y entrar' }).click();

    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Las dos contraseñas no coinciden.');
  });

  test('un número sin cuenta avanza igual: la pantalla no revela si existe', async ({ page }) => {
    await page.goto('/entrar/codigo');
    await page.getByLabel('Número de WhatsApp').fill(nacional(telefonoUnico()));
    await page.getByRole('button', { name: 'Mandarme el código' }).click();

    await expect(page.getByRole('heading', { name: 'Revisá tu WhatsApp' })).toBeVisible();
  });

  test('un segundo pedido para el mismo número dentro del minuto da 429', async ({ request }) => {
    const telefono = telefonoUnico();

    expect((await request.post(`${API_URL}/auth/whatsapp/codigo`, { data: { telefono } })).status()).toBe(202);
    expect((await request.post(`${API_URL}/auth/whatsapp/codigo`, { data: { telefono } })).status()).toBe(429);
  });
});
