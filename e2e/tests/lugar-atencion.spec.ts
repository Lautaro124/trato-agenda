import type { Page } from '@playwright/test';
import { agenteActual, crearAgentePorApi, esperarRuta, expect, sufijo, test } from './fixtures';
import { completarWizard, localEsperado, perfilProduccion, preguntaInicial, type LugarWizard } from './onboarding';

async function escribir(page: Page, texto: string): Promise<void> {
  await page.getByPlaceholder('Escribile al agente…').fill(texto);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

test.describe('lugar de atención del asistente de turnos (LAU-17)', () => {
  test('el wizard pide dónde atiende y lo guarda: en su casa, con dirección y mapa', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const lugar: LugarWizard = {
      opcion: 'casa',
      direccion: 'Güemes 4321, depto 3B, Palermo',
      enlaceUbicacion: 'https://maps.app.goo.gl/casa',
    };

    await page.goto('/contanos');
    await expect(preguntaInicial(page)).toBeVisible();
    await completarWizard(page, { ...perfilProduccion(sufijo()), lugar });
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');

    expect((await agenteActual(context.request))?.local).toEqual(localEsperado(lugar));
  });

  test('lo edita en /cuenta y el asistente lo dice al preguntarle y al agendar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await page.goto('/cuenta');
    const seccion = page.getByRole('region', { name: 'Dónde atendés' });
    // Un agente creado sin el paso todavía no tiene lugar: arranca en "local" y sin dirección.
    await expect(seccion.getByRole('radio', { name: /^En un local o consultorio/ })).toHaveAttribute('aria-checked', 'true');
    await expect(seccion.getByRole('button', { name: 'Guardar lugar' })).toBeDisabled();
    await seccion.getByLabel('Dirección', { exact: true }).fill('Av. Santa Fe 1234, piso 2');
    await seccion.getByRole('button', { name: 'Guardar lugar' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: tu asistente ya usa dónde atendés.');

    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Dónde atendés' }).getByLabel('Dirección', { exact: true }),
    ).toHaveValue('Av. Santa Fe 1234, piso 2');

    await page.goto('/inicio');
    await escribir(page, '¿Dónde queda el consultorio?');
    await expect(page.getByText('Es en Av. Santa Fe 1234, piso 2.')).toBeVisible();

    // Al agendar, la respuesta de crear_turno trae el lugar para decírselo al cliente.
    await escribir(page, 'Quiero un turno, soy Caro');
    await expect(page.getByText(/^Listo: Turno agendado para Caro.*Lugar: en el local, "Av\. Santa Fe 1234, piso 2"/)).toBeVisible();
  });

  test('sin lugar fijo, el asistente no da ninguna dirección', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, { local: { tieneLocal: false, horarios: [], retiroEnLocal: false } });

    await page.goto('/cuenta');
    await expect(
      page.getByRole('region', { name: 'Dónde atendés' }).getByRole('radio', { name: /^No tengo un lugar fijo/ }),
    ).toHaveAttribute('aria-checked', 'true');

    await page.goto('/inicio');
    await escribir(page, '¿cuál es la dirección?');
    await expect(page.getByText('No tenemos un lugar fijo: lo coordinamos por acá.')).toBeVisible();
  });
});
