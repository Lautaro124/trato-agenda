import { API_URL } from '../entorno';
import { crearAgentePorApi, eventosProximos, expect, fechaBA, horaBA, test, visible } from './fixtures';

/** Próximo día hábil (YYYY-MM-DD) en Buenos Aires, a partir de mañana. */
function proximoDiaHabil(): string {
  for (let dias = 1; dias < 8; dias++) {
    const ymd = fechaBA(new Date(Date.now() + dias * 24 * 60 * 60 * 1000));
    const diaSemana = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) return ymd;
  }
  throw new Error('no hay día hábil en la semana');
}

test.describe('agenda local (cuenta sin Google)', () => {
  test('/calendario crea un evento a mano y queda guardado en la base', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    const dia = proximoDiaHabil();

    await page.goto('/calendario');
    await page.getByRole('button', { name: 'Nuevo evento' }).click();
    await page.getByLabel('Título').fill('Almuerzo');
    await page.getByLabel('Fecha').fill(dia);
    await page.getByLabel('Desde').fill('13:00');
    await page.getByLabel('Hasta').fill('14:00');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect.poll(async () => (await eventosProximos(context.request)).length).toBe(1);
    const [evento] = await eventosProximos(context.request);
    expect(evento).toMatchObject({ resumen: 'Almuerzo', agendadoPorAgente: false });
    expect(fechaBA(new Date(evento.inicio))).toBe(dia);
    expect(horaBA(evento.inicio)).toBe('13:00');
    expect(horaBA(evento.fin)).toBe('14:00');

    // Sin Google, la referencia no habla de Google Calendar.
    await expect(visible(page.getByText('Cargado por vos'))).toBeVisible();
  });

  test('un evento que termina antes de empezar se rechaza', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const res = await context.request.post(`${API_URL}/calendar/eventos`, {
      data: { resumen: 'x', inicio: '2026-10-01T14:00:00-03:00', fin: '2026-10-01T13:00:00-03:00' },
    });
    expect(res.status()).toBe(400);
  });

  test('/cuenta ofrece conectar Google Calendar a una cuenta con agenda local', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    await page.goto('/cuenta');

    await expect(page.getByRole('heading', { name: 'Tu agenda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Conectar Google Calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Permisos de Google' })).toHaveCount(0);
  });

  test('/cuenta muestra el resultado de conectar Google', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    await page.goto('/cuenta?google=google_en_uso');

    await expect(page.getByRole('status')).toContainText('ya es de otro usuario');
  });
});
