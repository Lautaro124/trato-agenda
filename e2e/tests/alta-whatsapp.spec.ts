import { API_URL } from '../entorno';
import { esperarRuta, expect, test } from './fixtures';

test.describe('alta sólo con WhatsApp', () => {
  test('/entrar ofrece crear la cuenta con WhatsApp y lleva a la pantalla del QR de alta', async ({ page }) => {
    await page.goto('/entrar');

    await page.getByRole('link', { name: 'Creala con tu WhatsApp' }).click();
    await esperarRuta(page, '/entrar/whatsapp');

    // Sin escanear: el QR depende de los servidores de WhatsApp, así que alcanza
    // con que la pantalla llegue a un estado conocido (código o error con reintento).
    await expect(
      page
        .getByRole('heading', { name: 'Creá tu cuenta con WhatsApp' })
        .or(page.getByText('No pudimos conectar')),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('la cookie del alta no sirve como sesión', async ({ page, context }) => {
    await page.goto('/entrar/whatsapp');
    await expect
      .poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'trato_alta'), { timeout: 30_000 })
      .toBe(true);

    const me = await context.request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(401);
  });

  test('finalizar sin haber escaneado da 409', async ({ page, context }) => {
    await page.goto('/entrar/whatsapp');
    await expect
      .poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'trato_alta'), { timeout: 30_000 })
      .toBe(true);

    const res = await context.request.post(`${API_URL}/auth/whatsapp/alta/finalizar`);
    expect(res.status()).toBe(409);
  });

  test('sin la cookie del alta, el stream y finalizar dan 401', async ({ request }) => {
    expect((await request.post(`${API_URL}/auth/whatsapp/alta/finalizar`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/auth/whatsapp/alta/stream`)).status()).toBe(401);
  });
});
