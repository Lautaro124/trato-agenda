import { API_URL } from '../entorno';
import { crearAgentePorApi, eventosProximos, expect, fechaBA, hablarConAgente, horaBA, test, visible } from './fixtures';

/** Lunes (YYYY-MM-DD) de la semana de una fecha "YYYY-MM-DD". */
function lunesDe(ymd: string): string {
  const fecha = new Date(`${ymd}T12:00:00Z`);
  const desplazamiento = (fecha.getUTCDay() + 6) % 7;
  fecha.setUTCDate(fecha.getUTCDate() - desplazamiento);
  return fecha.toISOString().slice(0, 10);
}

test.describe('el agente generado funcionando (calendario falso)', () => {
  test('agenda, reprograma y cancela un turno desde el banco de pruebas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
      horaDesde: '09:00',
      horaHasta: '18:00',
    });

    // 1. Agenda: el stub pide crear_turno y la API lo escribe en el calendario falso.
    expect((await hablarConAgente(context.request, 'Hola, quiero un turno, soy Caro')).reply).toMatch(/^Listo: Turno agendado para Caro/m);

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
    expect((await hablarConAgente(context.request, 'mejor movelo una hora más tarde')).reply).toMatch(/^Listo: Turno reprogramado/m);

    eventos = await eventosProximos(context.request);
    expect(eventos).toHaveLength(1);
    expect(horaBA(eventos[0].inicio)).toBe('11:00');

    // 3. Cancela.
    expect((await hablarConAgente(context.request, 'cancelá el turno porfa')).reply).toMatch(/^Listo: Turno del .* cancelado\./m);
    expect(await eventosProximos(context.request)).toHaveLength(0);

    // 4. Reiniciar borra la charla de prueba.
    expect((await context.request.delete(`${API_URL}/conversation/test`)).ok()).toBe(true);
  });

  test('si falta el nombre, lo pregunta antes de agendar', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    expect((await hablarConAgente(context.request, 'quiero un turno para mañana')).reply).toContain('¿A nombre de quién agendo el turno?');
    expect(await eventosProximos(context.request)).toHaveLength(0);
  });

  test('/inicio sin agente manda a completar el onboarding', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    await page.goto('/inicio');

    await expect(page).toHaveURL(/\/contanos$/);
  });
});
