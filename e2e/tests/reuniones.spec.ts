import { agenteActual, crearAgentePorApi, eventosProximos, expect, horaBA, test } from './fixtures';
import { elegirDuracion, selectorDuracion, tarjetaEvento } from './onboarding';

test.describe('editar reuniones después del onboarding', () => {
  test('cambia duración y precio, persiste y el asistente lo usa en el próximo turno', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
    });

    await page.goto('/reuniones');
    await expect(page.getByRole('heading', { name: 'Tus reuniones' })).toBeVisible();

    const guardar = page.getByRole('button', { name: 'Guardar cambios' });
    await expect(guardar).toBeDisabled();

    await elegirDuracion(page, 'Control', 45);
    await page.getByLabel('Precio de Control', { exact: true }).fill('15000');
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(page.getByText('Listo: tu asistente ya usa estas reuniones.')).toBeVisible();
    await expect(guardar).toBeDisabled();

    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 45, precio: 15000 },
    ]);

    // Recargar muestra lo guardado.
    await page.reload();
    await expect(selectorDuracion(page, 'Control').locator('output')).toHaveText('45 min');
    await expect(page.getByLabel('Precio de Control', { exact: true })).toHaveValue('15.000');

    // El asistente agenda con la duración nueva.
    await page.goto('/inicio');
    await page.getByPlaceholder('Escribile al agente…').fill('Hola, quiero un turno, soy Caro');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText(/^Listo: Turno agendado para Caro/)).toBeVisible();

    const [evento] = await eventosProximos(context.request);
    expect(horaBA(evento.fin)).toBe('10:45');
  });

  test('no deja guardar sin ninguna reunión activa', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    await page.goto('/reuniones');
    await tarjetaEvento(page, 'Control').click();

    await expect(page.getByText('Dejá al menos una reunión activa.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  test('sin agente manda al onboarding', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/reuniones');
    await expect(page).toHaveURL(/\/contanos/);
  });
});

test.describe('editar reuniones en el celular @movil', () => {
  test('se llega desde la barra inferior', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    await page.goto('/inicio');
    await page.getByRole('link', { name: 'Reuniones' }).click();

    await expect(page.getByRole('heading', { name: 'Tus reuniones' })).toBeVisible();
  });
});
