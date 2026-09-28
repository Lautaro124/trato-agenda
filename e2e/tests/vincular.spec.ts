import {
  crearAgentePorApi,
  emailUnico,
  esperarRuta,
  expect,
  loginDev,
  ponerPassword,
  sufijo,
  telefonoUnico,
  test,
} from './fixtures';
import { completarWizardEscritorio, perfilProduccion } from './onboarding';

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

  test('una cuenta que ya escaneó el QR no vuelve a vincular: va a la agenda o a los planes', async ({ page, context }) => {
    // Con teléfono, el usuario dev imita un alta hecha sólo con WhatsApp.
    await loginDev(context.request, emailUnico(), telefonoUnico());
    await ponerPassword(context.request, 'mi-clave-segura');

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfilProduccion(sufijo()));
    await expect(page.getByRole('button', { name: 'Vincular WhatsApp' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Crear mi asistente' }).click();
    await esperarRuta(page, '/listo');

    await expect(page.getByText('Prueba activa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vincular WhatsApp y empezar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ir a mi agenda' })).toBeVisible();
    await page.getByRole('button', { name: 'Ver planes' }).click();
    await esperarRuta(page, '/plan');
  });
});
