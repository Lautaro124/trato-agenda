import { API_URL } from '../entorno';
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
import { completarWizard, perfilProduccion } from './onboarding';

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
    await completarWizard(page, perfilProduccion(sufijo()));
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

const AVISO_NUMERO_PERSONAL = 'No te recomendamos usar tu celular personal.';

test.describe('/vincular: QR en la computadora, código en el celular', () => {
  test('en la computadora arranca con el QR, avisa del número personal y deja pasar al código', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await page.goto('/vincular');
    await expect(page.getByRole('heading', { name: 'Vinculá tu WhatsApp' })).toBeVisible();
    await expect(page.getByText('Dispositivos vinculados')).toBeVisible();
    await expect(page.getByText(AVISO_NUMERO_PERSONAL)).toBeVisible();

    await page.getByRole('button', { name: /Vinculá con un código/ }).click();
    await expect(page.getByRole('form', { name: 'Vincular con código' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Número de WhatsApp' })).toBeVisible();
  });

  test('pedir el código valida el número y exige sesión', async ({ context, request, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    const invalido = await context.request.post(`${API_URL}/whatsapp/link/codigo`, { data: { telefono: '123' } });
    expect(invalido.status()).toBe(400);

    const sinSesion = await request.post(`${API_URL}/whatsapp/link/codigo`, { data: { telefono: '5491122334455' } });
    expect(sinSesion.status()).toBe(401);
  });
});

test.describe('/vincular en el celular', { tag: '@movil' }, () => {
  test('arranca con el código, avisa del número personal y deja pasar al QR', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await page.goto('/vincular');
    // El código no depende de los servidores de WhatsApp hasta que se pide.
    await expect(page.getByRole('form', { name: 'Vincular con código' })).toBeVisible();
    await expect(page.getByText(AVISO_NUMERO_PERSONAL)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pedir código' })).toBeDisabled();

    await page.getByRole('textbox', { name: 'Número de WhatsApp' }).fill('11 2233 4455');
    await expect(page.getByRole('button', { name: 'Pedir código' })).toBeEnabled();

    await page.getByRole('button', { name: 'Prefiero escanear un QR desde otro teléfono' }).click();
    await expect(
      page.getByText('Dispositivos vinculados').or(page.getByText('No pudimos vincular tu WhatsApp')),
    ).toBeVisible({ timeout: 30_000 });
  });
});
