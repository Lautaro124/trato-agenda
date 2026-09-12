import { agenteActual, esperarRuta, expect, sufijo, test } from './fixtures';
import { completarWizardEscritorio, payloadEsperado, perfilProduccion } from './onboarding';

/**
 * Contra OpenRouter de verdad (`npm run e2e:real`, stack SIN el override de
 * e2e). Cuesta centavos por corrida. Es la prueba de que el modelo configurado
 * en OPENROUTER_MODEL_AGENTES / OPENROUTER_MODEL genera a tiempo el perfil
 * que en producción terminó en 502.
 */
test.describe('generación contra OpenRouter real', { tag: '@real' }, () => {
  test('el caso de producción genera en menos de 60s y el agente contesta', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);

    const inicio = Date.now();
    const respuesta = page.waitForResponse('**/agents/generate', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    const res = await respuesta;
    const demora = Date.now() - inicio;

    console.log(`Generación real: HTTP ${res.status()} en ${demora} ms`);
    expect(res.status()).toBe(201);
    expect(demora).toBeLessThan(60_000);
    await esperarRuta(page, '/listo');
    expect(await agenteActual(context.request)).toMatchObject(payloadEsperado(perfil));

    await page.goto('/inicio');
    await page.getByPlaceholder('Escribile al agente…').fill('Hola! ¿Qué tipos de turno tomás?');
    const charla = page.waitForResponse('**/conversation/test', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Enviar' }).click();

    // El texto del modelo no es determinista: se chequea que conteste algo útil y no la disculpa.
    const { reply } = (await (await charla).json()) as { reply: string };
    console.log(`Respuesta real del agente: ${reply}`);
    expect(reply.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(reply.trim().slice(0, 40), { exact: false })).toBeVisible();
    await expect(page.getByText('Perdón, tuve un problema para responderte')).toHaveCount(0);
  });
});
