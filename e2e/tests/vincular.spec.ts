import { crearAgentePorApi, esperarRuta, expect, test } from './fixtures';

test.describe('después de generar: /listo y /vincular', () => {
  test('/listo anuncia la prueba y lleva a la pantalla del QR', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await page.goto('/listo');
    await expect(page.getByText('Prueba activa')).toBeVisible();
    await page.getByRole('button', { name: 'Vincular WhatsApp y empezar' }).click();
    await esperarRuta(page, '/vincular');

    // Sin escanear: el QR depende de los servidores de WhatsApp, así que alcanza
    // con que la pantalla llegue a un estado conocido (código o error con reintento).
    await expect(
      page
        .getByRole('heading', { name: 'Vinculá tu WhatsApp' })
        .or(page.getByText('No pudimos vincular tu WhatsApp')),
    ).toBeVisible({ timeout: 30_000 });
  });
});
