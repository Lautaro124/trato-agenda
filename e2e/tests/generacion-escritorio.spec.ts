import {
  agenteActual,
  crearAgentePorApi,
  esperarRuta,
  expect,
  llamadasDelStub,
  sufijo,
  test,
  visible,
} from './fixtures';
import { completarWizardEscritorio, payloadEsperado, perfilProduccion, type PerfilWizard } from './onboarding';

test.describe('generación de agente: wizard de escritorio', () => {
  test('el caso de producción: "Otro" con cinco tipos propios genera el agente y sigue a /vincular', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    await page.goto('/contanos');
    await expect(visible(page.getByText('Paso 2 de 3'))).toBeVisible();
    await completarWizardEscritorio(page, perfil);

    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');
    await expect(page.getByText('Prueba activa')).toBeVisible();

    // Lo que quedó guardado es exactamente lo que se cargó en el wizard.
    const agente = await agenteActual(context.request);
    expect(agente).toMatchObject(payloadEsperado(perfil));
    expect(agente?.allowedActions).toEqual(
      expect.arrayContaining(['consultar_disponibilidad', 'crear_turno', 'cancelar_turno', 'reprogramar_turno']),
    );
    expect(agente).not.toHaveProperty('systemPrompt');

    // Y la API le pidió la config al modelo de agentes, con structured outputs y tope de tokens.
    const llamadas = await llamadasDelStub(context.request, perfil.nombreTitular);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({
      tipo: 'generacion',
      model: 'stub/agentes',
      max_tokens: 3000,
      response_format: { type: 'json_schema', json_schema: { name: 'config_agente', strict: true } },
      provider: { require_parameters: true },
      reasoning: { enabled: false },
    });

    await page.getByRole('button', { name: 'Vincular WhatsApp y empezar' }).click();
    await esperarRuta(page, '/vincular');
  });

  test('regenerar desde /contanos pisa el agente anterior', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const anterior = await crearAgentePorApi(context.request, { tipoUso: 'otro', nombreBot: 'Beto' });

    const perfil: PerfilWizard = {
      tipoTitular: 'persona',
      nombreTitular: `Lucía Fernández ${sufijo()}`,
      tipoUso: 'consultorio',
      sugeridos: [
        { nombre: 'Primera consulta', duracionMin: 45 },
        { nombre: 'Consulta de control', duracionMin: 30 },
      ],
      preset: { label: 'Tarde', desde: '14:00', hasta: '19:00' },
      nombreBot: 'Sofi',
    };

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');

    const agente = await agenteActual(context.request);
    expect(agente?.id).toBe(anterior.id);
    expect(agente).toMatchObject(payloadEsperado(perfil));
  });

  test('mientras genera, el botón queda deshabilitado y avisa que puede tardar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    // Demora la respuesta de la API para poder ver el estado intermedio.
    await context.route('**/agents/generate', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.goto('/contanos');
    await completarWizardEscritorio(page, perfil);
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();

    await expect(page.getByRole('button', { name: 'Creando tu asistente…' })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveText('Estamos armando tu asistente, puede tardar hasta un minuto.');
    await esperarRuta(page, '/listo');
  });
});
