import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { completarWizard, payloadEsperado, perfilProduccion, preguntaInicial, type PerfilWizard } from './onboarding';

test.describe('generación de agente: wizard en el celular', { tag: '@movil' }, () => {
  test('el caso de producción, un paso por pantalla', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    await page.goto('/contanos');
    await expect(preguntaInicial(page)).toBeVisible();
    await expect(visible(page.getByText('Paso 1 de 5'))).toBeVisible();

    await completarWizard(page, perfil);
    await expect(visible(page.getByText('Paso 5 de 5'))).toBeVisible();
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();

    await esperarRuta(page, '/listo');
    expect(await agenteActual(context.request)).toMatchObject(payloadEsperado(perfil));
  });

  test('una persona con tipos sugeridos del catálogo', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil: PerfilWizard = {
      tipoTitular: 'persona',
      nombreTitular: `Dra. Martina ${sufijo()}`,
      tipoUso: 'consultorio',
      sugeridos: [
        { nombre: 'Consulta de control', duracionMin: 30, precio: 12000 },
        { nombre: 'Urgencia', duracionMin: 15 },
      ],
      preset: { label: 'Extendida', desde: '08:00', hasta: '21:00' },
      nombreBot: 'Beto',
    };

    await page.goto('/contanos');
    await completarWizard(page, perfil);
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();

    await esperarRuta(page, '/listo');
    expect(await agenteActual(context.request)).toMatchObject(payloadEsperado(perfil));
  });

  test('volver al paso anterior no pierde lo cargado', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('¿Cómo se llama tu negocio?').fill('Kiosco Rápido');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¿Qué turnos das?' })).toBeVisible();

    await page.getByRole('button', { name: 'Volver al paso anterior' }).click();
    await expect(page.getByLabel('¿Cómo se llama tu negocio?')).toHaveValue('Kiosco Rápido');
  });
});
