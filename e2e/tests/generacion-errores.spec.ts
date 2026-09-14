import { expect, sufijo, test } from './fixtures';
import { completarWizardEscritorio, perfilProduccion } from './onboarding';

test.describe('generación de agente: errores de alta', () => {
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
