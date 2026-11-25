import { request as crearRequest, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, esperarRuta, expect, loginDev, nacional, ponerPassword, telefonoUnico, test } from './fixtures';

const PASSWORD = 'clave-vieja-123';

/** Lo último que la API "mandó" a ese email (sin Resend en el stack): se espera a que aparezca. */
async function ultimoEmail(request: APIRequestContext, para: string, asunto: RegExp): Promise<string> {
  let texto = '';
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/auth/dev/ultimo-email?para=${encodeURIComponent(para)}`);
        const email = (await res.json()) as { asunto: string | null; texto: string | null };
        texto = email.texto ?? '';
        return email.asunto ?? '';
      },
      { timeout: 10_000 },
    )
    .toMatch(asunto);
  return texto;
}

const codigoDe = (texto: string): string => texto.match(/\d{6}/)![0];

/**
 * LAU-109: una cuenta creada con WhatsApp suma un email de recuperación desde
 * Tu cuenta y, con WhatsApp desconectado (el usuario dev no tiene socket),
 * recupera el acceso con el código que llega a ese email.
 */
test.describe('email de recuperación', () => {
  test('lo suma desde Tu cuenta, lo confirma y recupera el acceso por email sin WhatsApp', async ({ page }) => {
    const telefono = telefonoUnico();
    const email = emailUnico();
    await loginDev(page.context().request, emailUnico(), telefono);
    await ponerPassword(page.context().request, PASSWORD);
    await crearAgentePorApi(page.context().request);

    // El aviso de migración aparece en Inicio y lleva a la sección.
    await page.goto('/inicio');
    await page.getByRole('link', { name: 'Sumar email' }).click();
    await esperarRuta(page, '/cuenta');

    await page.getByLabel('Email de recuperación').fill(email);
    await page.getByLabel('Contraseña actual para el email').fill(PASSWORD);
    await page.getByRole('button', { name: 'Mandarme el código' }).click();

    const codigo = codigoDe(await ultimoEmail(page.context().request, email, /Confirmá tu email/));
    await page.getByLabel('Código del email').fill(codigo);
    await page.getByRole('button', { name: 'Confirmar email' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'quedó confirmado' })).toBeVisible();

    // Recuperar desde otro navegador, sin sesión.
    const aparte = await crearRequest.newContext();
    expect((await aparte.post(`${API_URL}/auth/whatsapp/codigo`, { data: { telefono } })).status()).toBe(202);
    const codigoAcceso = codigoDe(await ultimoEmail(aparte, email, /Tu código para entrar/));
    const recuperado = await aparte.post(`${API_URL}/auth/whatsapp/codigo/verificar`, {
      data: { telefono, codigo: codigoAcceso, nuevaPassword: 'clave-nueva-456' },
    });
    expect(recuperado.status()).toBe(200);

    // Se avisa al email que la contraseña cambió, y la vieja deja de servir.
    await ultimoEmail(aparte, email, /Cambió la contraseña/);
    expect(
      (await aparte.post(`${API_URL}/auth/whatsapp/login`, { data: { telefono, password: PASSWORD } })).status(),
    ).toBe(401);
    await aparte.dispose();
  });

  test('sin la contraseña actual no manda el código', async ({ page }) => {
    const telefono = telefonoUnico();
    await loginDev(page.context().request, emailUnico(), telefono);
    await ponerPassword(page.context().request, PASSWORD);
    await crearAgentePorApi(page.context().request);

    await page.goto('/cuenta');
    await page.getByLabel('Email de recuperación').fill(emailUnico());
    await page.getByLabel('Contraseña actual para el email').fill('no-es-esta');
    await page.getByRole('button', { name: 'Mandarme el código' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'La contraseña actual no es correcta.' })).toBeVisible();
    await expect(page.getByLabel('Código del email')).toHaveCount(0);
  });

  test('la pantalla de recuperar contraseña ofrece el email y el número', async ({ page }) => {
    await page.goto('/entrar/codigo');
    await page.getByLabel('Número de WhatsApp').fill(nacional(telefonoUnico()));
    await page.getByRole('button', { name: 'Mandarme el código' }).click();

    await expect(page.getByRole('heading', { name: 'Revisá tu WhatsApp o tu email' })).toBeVisible();
  });
});
