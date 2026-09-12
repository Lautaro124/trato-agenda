import { API_URL } from '../entorno';
import {
  crearAgentePorApi,
  esperarRuta,
  expect,
  llamadasDelStub,
  test,
  visible,
} from './fixtures';

/**
 * Lo que pide la verificación OAuth de Google y que es fácil romper sin
 * notarlo: los enlaces legales en la pantalla que dispara el consentimiento, la
 * declaración de Limited Use publicada, el borrado de cuenta por autoservicio y
 * la política de no-entrenamiento viajando en cada llamada al modelo.
 * Ver docs/verificacion-google.md.
 */
test.describe('páginas legales', () => {
  test('/entrar linkea a privacidad y términos', async ({ page }) => {
    await page.goto('/entrar');

    await expect(visible(page.getByRole('link', { name: 'Privacidad' }))).toBeVisible();
    await expect(visible(page.getByRole('link', { name: 'Términos' }))).toBeVisible();
  });

  test('/privacidad publica la declaración de Limited Use y lo que no se manda al modelo', async ({ page }) => {
    await page.goto('/privacidad');

    // La frase la exige Google textual, en inglés: si alguien la traduce o la
    // recorta, la verificación se cae.
    await expect(page.locator('blockquote')).toContainText(
      'The use of raw or derived user data received from Workspace APIs will adhere to the Google User Data Policy, including the Limited Use requirements.',
    );

    await expect(page.getByRole('heading', { name: 'Uso de inteligencia artificial' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cómo protegemos tus datos' })).toBeVisible();
    await expect(page.getByText('data_collection: "deny"')).toBeVisible();
  });
});

test.describe('borrado de cuenta', () => {
  test('el botón se habilita sólo al confirmar, y borra la sesión y los datos', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    await page.goto('/cuenta');
    await expect(page.getByText(usuarioDev.email)).toBeVisible();

    const boton = page.getByRole('button', { name: 'Eliminar mi cuenta y mis datos' });
    await expect(boton).toBeDisabled();

    const confirmacion = page.getByLabel('Escribí ELIMINAR para habilitar el botón');

    // Una confirmación parecida no alcanza: es una acción irreversible.
    await confirmacion.fill('eliminar');
    await expect(boton).toBeDisabled();

    await confirmacion.fill('ELIMINAR');
    await expect(boton).toBeEnabled();
    await boton.click();

    // Vuelve a la landing con la cookie ya limpia.
    await esperarRuta(page, '/');
    const me = await context.request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(401);

    // Y una pantalla con guard ya no deja entrar.
    await page.goto('/inicio');
    await esperarRuta(page, '/entrar');
  });
});

test.describe('política de datos hacia el modelo', () => {
  test('toda llamada al modelo viaja con data_collection deny y zdr', async ({ context, usuarioDev }) => {
    const agente = await crearAgentePorApi(context.request);
    expect(usuarioDev.email).toBeTruthy();

    const llamadas = await llamadasDelStub(context.request, agente.nombreTitular);
    expect(llamadas.length).toBeGreaterThan(0);

    for (const llamada of llamadas) {
      expect(llamada.provider, `llamada ${llamada.tipo} sin política de proveedor`).toMatchObject({
        data_collection: 'deny',
        zdr: true,
      });
    }
  });
});
