import type { Page } from '@playwright/test';
import { crearAgentePorApi, eventosProximos, expect, fechaBA, horaBA, test, visible } from './fixtures';

/** Lunes (YYYY-MM-DD) de la semana de una fecha "YYYY-MM-DD". */
function lunesDe(ymd: string): string {
  const fecha = new Date(`${ymd}T12:00:00Z`);
  const desplazamiento = (fecha.getUTCDay() + 6) % 7;
  fecha.setUTCDate(fecha.getUTCDate() - desplazamiento);
  return fecha.toISOString().slice(0, 10);
}

async function escribir(page: Page, texto: string): Promise<void> {
  const campo = page.getByPlaceholder('Escribile al agente…');
  await campo.fill(texto);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

test.describe('el agente generado funcionando (calendario falso)', () => {
  test('agenda, reprograma y cancela un turno desde el chat de prueba', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
      horaDesde: '09:00',
      horaHasta: '18:00',
    });

    await page.goto('/inicio');
    await expect(page.getByPlaceholder('Escribile al agente…')).toBeVisible();

    // 1. Agenda: el stub pide crear_turno y la API lo escribe en el calendario falso.
    await escribir(page, 'Hola, quiero un turno, soy Caro');
    await expect(page.getByText(/^Listo: Turno agendado para Caro/)).toBeVisible();

    let eventos = await eventosProximos(context.request);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ resumen: 'Control - Caro', agendadoPorAgente: true });
    expect(horaBA(eventos[0].inicio)).toBe('10:00');
    expect(horaBA(eventos[0].fin)).toBe('10:30');

    // Y se ve en /calendario, en la semana que corresponda.
    await page.goto('/calendario');
    if (lunesDe(fechaBA(new Date(eventos[0].inicio))) !== lunesDe(fechaBA(new Date()))) {
      await page.getByRole('button', { name: '›' }).click();
    }
    await expect(visible(page.getByText('Control - Caro'))).toBeVisible();

    // 2. Reprograma una hora más tarde.
    await page.goto('/inicio');
    await escribir(page, 'mejor movelo una hora más tarde');
    await expect(page.getByText(/^Listo: Turno reprogramado/)).toBeVisible();

    eventos = await eventosProximos(context.request);
    expect(eventos).toHaveLength(1);
    expect(horaBA(eventos[0].inicio)).toBe('11:00');

    // 3. Cancela.
    await escribir(page, 'cancelá el turno porfa');
    await expect(page.getByText(/^Listo: Turno del .* cancelado\./)).toBeVisible();
    expect(await eventosProximos(context.request)).toHaveLength(0);

    // 4. Reiniciar limpia la charla en pantalla.
    await page.getByRole('button', { name: 'Reiniciar' }).click();
    await expect(page.getByText(/^Listo:/)).toHaveCount(0);
  });

  test('si falta el nombre, lo pregunta antes de agendar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await page.goto('/inicio');
    await escribir(page, 'quiero un turno para mañana');

    await expect(page.getByText('¿A nombre de quién agendo el turno?')).toBeVisible();
    expect(await eventosProximos(context.request)).toHaveLength(0);
  });

  test('/inicio sin agente manda a completar el onboarding', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    await page.goto('/inicio');

    await expect(page).toHaveURL(/\/contanos$/);
  });
});
