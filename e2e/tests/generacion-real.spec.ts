import { crearAgentePorApi, expect, test } from './fixtures';

/**
 * Contra OpenRouter de verdad (`npm run e2e:real`, stack SIN el override de
 * e2e). Cuesta centavos por corrida. La generación del agente ya no depende
 * de OpenRouter (plantilla determinista, cubierto sin costo en
 * `generacion-escritorio.spec.ts`): lo único que sigue necesitando un modelo
 * real acá es la charla por WhatsApp/Home.
 */
test.describe('conversación contra OpenRouter real', { tag: '@real' }, () => {
  test('el agente creado por la plantilla contesta con un modelo real', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

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
