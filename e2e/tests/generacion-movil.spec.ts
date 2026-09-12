import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { completarFormularioMovil, payloadEsperado, perfilProduccion, type PerfilWizard } from './onboarding';

test.describe('generación de agente: formulario móvil', { tag: '@movil' }, () => {
  test('el caso de producción en una sola pantalla', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil = perfilProduccion(sufijo());

    await page.goto('/contanos');
    await expect(visible(page.getByText('Contanos de vos'))).toBeVisible();

    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(continuar).toBeDisabled();

    await completarFormularioMovil(page, perfil);
    await expect(continuar).toBeEnabled();
    await continuar.click();

    await esperarRuta(page, '/listo');
    expect(await agenteActual(context.request)).toMatchObject(payloadEsperado(perfil));
  });

  test('una persona con tipos sugeridos del catálogo', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const perfil: PerfilWizard = {
      tipoTitular: 'persona',
      nombreTitular: `Profe Martín ${sufijo()}`,
      tipoUso: 'personal',
      sugeridos: [
        { nombre: 'Clase', duracionMin: 60 },
        { nombre: 'Entrenamiento', duracionMin: 45 },
      ],
      preset: { label: 'Extendida', desde: '08:00', hasta: '21:00' },
      nombreBot: 'Beto',
    };

    await page.goto('/contanos');
    await completarFormularioMovil(page, perfil);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    await esperarRuta(page, '/listo');
    expect(await agenteActual(context.request)).toMatchObject(payloadEsperado(perfil));
  });
});
