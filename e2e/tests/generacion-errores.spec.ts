import { agenteActual, esperarRuta, expect, llamadasDelStub, sufijo, test } from './fixtures';
import { completarWizardEscritorio, perfilProduccion } from './onboarding';

test.describe('generación de agente: el modelo falla', () => {
  test('si el primer JSON viene roto, la API reintenta y el alta termina bien', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = { ...perfilProduccion(sufijo()), nombreTitular: `Estudio [json-roto] ${sufijo()}` };

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();

    await esperarRuta(page, '/listo');
    expect((await agenteActual(context.request))?.nombreTitular).toBe(perfil.nombreTitular);

    const llamadas = await llamadasDelStub(context.request, perfil.nombreTitular);
    expect(llamadas.map((llamada) => llamada.intento)).toEqual([1, 2]);
  });

  test('si el proveedor se cae, muestra el error, deja reintentar y no crea el agente', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = { ...perfilProduccion(sufijo()), nombreTitular: `Estudio [falla] ${sufijo()}` };

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);

    const respuesta = page.waitForResponse('**/agents/generate');
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    expect((await respuesta).status()).toBe(502);

    // Next monta un anunciador de rutas con role="alert" vacío: se filtra por texto.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('El asistente tardó demasiado en armarse. Probá de nuevo.');
    await expect(page).toHaveURL(/\/contanos$/);
    await expect(page.getByRole('button', { name: 'Vincular WhatsApp' })).toBeEnabled();
    expect(await agenteActual(context.request)).toBeNull();

    // Un 5xx es de transporte: se reintenta una sola vez con el mismo pedido.
    expect(await llamadasDelStub(context.request, perfil.nombreTitular)).toHaveLength(2);
  });

  test('si la sesión venció, lo dice en vez de un error genérico', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);
    await context.clearCookies();
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();

    // Next monta un anunciador de rutas con role="alert" vacío: se filtra por texto.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Tu sesión venció. Volvé a entrar para crear tu asistente.');
  });
});
