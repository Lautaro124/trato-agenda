import { API_URL } from '../entorno';
import { esperarRuta, expect, test } from './fixtures';

/**
 * Crear la cuenta escaneando el QR quedó cerrado: las cuentas nuevas se crean
 * con Google y conectan WhatsApp Business por la API oficial de Meta.
 */
test.describe('sin alta por QR', () => {
  test('/entrar ofrece crear la cuenta sólo con Google', async ({ page }) => {
    await page.goto('/entrar');

    await page.getByRole('tab', { name: 'Soy nuevo' }).click();
    await expect(page.getByRole('button', { name: 'Crear cuenta con Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear cuenta con WhatsApp' })).toHaveCount(0);
  });

  test('/entrar/whatsapp lleva a /entrar', async ({ page }) => {
    await page.goto('/entrar/whatsapp');
    await esperarRuta(page, '/entrar');
  });

  test('la API no arranca altas por QR', async ({ request }) => {
    expect((await request.post(`${API_URL}/auth/whatsapp/alta`)).status()).toBe(410);
    // Sin la cookie del alta, el resto de las rutas no tienen a quién atender.
    expect((await request.post(`${API_URL}/auth/whatsapp/alta/finalizar`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/auth/whatsapp/alta/stream`)).status()).toBe(401);
  });
});
