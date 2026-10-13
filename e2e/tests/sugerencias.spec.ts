import { API_URL } from '../entorno';
import { crearAgentePorApi, expect, test } from './fixtures';

const VALIDA = 'Me gustaría que el asistente mande un recordatorio el día antes del turno.';

test.describe('sugerencias de mejora (LAU-14)', () => {
  test('se manda una desde el header, con la validación de solo texto', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    await page.goto('/inicio');

    await page.getByRole('button', { name: 'Sugerir mejora' }).click();
    const panel = page.getByRole('dialog', { name: 'Sugerí una mejora' });
    await expect(panel).toBeVisible();

    const texto = panel.getByLabel('Tu sugerencia');
    const enviar = panel.getByRole('button', { name: 'Enviar sugerencia' });

    // HTML, links y mails no pasan: lo dice al escribir y no deja mandar.
    await texto.fill('Quiero <b>negritas</b> en el chat');
    await expect(panel.getByRole('alert')).toContainText('«<»');
    await expect(enviar).toBeDisabled();

    await texto.fill('Como hace trato.com con los recordatorios');
    await expect(panel.getByRole('alert')).toContainText('Sacá el link');
    await expect(enviar).toBeDisabled();

    await texto.fill('Escribanme a yo@gmail.com por favor');
    await expect(panel.getByRole('alert')).toContainText('«@»');

    await panel.getByText('Algo no anda bien').click();
    await texto.fill(VALIDA);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await enviar.click();

    await expect(panel.getByRole('status')).toContainText('¡Gracias! La recibimos.');
    await panel.getByRole('button', { name: 'Listo' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('la API rechaza lo que no es solo texto y aplica el tope diario', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const api = context.request;

    const html = await api.post(`${API_URL}/mejoras`, { data: { tipo: 'idea', texto: '<script>alert(1)</script> hola' } });
    expect(html.status()).toBe(400);

    const campoDeMas = await api.post(`${API_URL}/mejoras`, { data: { tipo: 'idea', texto: VALIDA, archivo: 'x' } });
    expect(campoDeMas.status()).toBe(400);

    const archivo = await api.post(`${API_URL}/mejoras`, {
      multipart: { tipo: 'idea', texto: VALIDA, archivo: { name: 'a.html', mimeType: 'text/html', buffer: Buffer.from('<b>x</b>') } },
    });
    expect(archivo.status()).toBe(415);

    for (let i = 0; i < 5; i++) {
      const res = await api.post(`${API_URL}/mejoras`, { data: { tipo: 'otro', texto: `${VALIDA} Número ${i}` } });
      expect(res.status(), await res.text()).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
    }
    const sexta = await api.post(`${API_URL}/mejoras`, { data: { tipo: 'otro', texto: VALIDA } });
    expect(sexta.status()).toBe(429);
  });

  test('en el celular se llega desde el menú de la cuenta @movil', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    await page.goto('/inicio');

    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Sugerir mejora' }).click();
    const panel = page.getByRole('dialog', { name: 'Sugerí una mejora' });
    await panel.getByLabel('Tu sugerencia').fill(VALIDA);
    await panel.getByRole('button', { name: 'Enviar sugerencia' }).click();
    await expect(panel.getByRole('status')).toContainText('¡Gracias! La recibimos.');
  });
});
