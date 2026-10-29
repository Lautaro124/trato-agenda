import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { crearAgentePorApi, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import {
  botonContinuar,
  completarWizard,
  elegirAsistente,
  MANANA,
  perfilProduccion,
  preguntaHorarioAtencion,
  preguntaInicial,
} from './onboarding';

type HorarioAtencion = {
  activo: boolean;
  franjas: Array<{ dia: string; desde: string; hasta: string }>;
  zona: string;
  resumen: string;
};

async function horarioActual(request: APIRequestContext): Promise<HorarioAtencion> {
  const res = await request.get(`${API_URL}/horario-atencion`);
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<HorarioAtencion>;
}

const LABORABLES = ['lun', 'mar', 'mie', 'jue', 'vie'];

/** El estado del header sin WhatsApp vinculado de verdad: la respuesta de la API, fija. */
async function fijarEstado(page: Page, estado: Record<string, unknown>): Promise<void> {
  await page.route(`${API_URL}/asistente/estado`, (route) => route.fulfill({ json: estado }));
}

/** Un comercio que vende sólo online, hasta el paso "Cuándo atiende". */
async function hastaCuandoAtiendeVentas(page: Page): Promise<void> {
  await page.goto('/contanos');
  await elegirAsistente(page, 'ventas');
  await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(`Mates E2E ${sufijo()}`);
  await botonContinuar(page).click();
  await botonContinuar(page).click();
  await botonContinuar(page).click();
  await expect(preguntaHorarioAtencion(page)).toBeVisible();
}

async function terminarVentas(page: Page): Promise<void> {
  await botonContinuar(page).click();
  await visible(page.getByLabel('Nombre del asistente')).fill('Sol');
  await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
  await esperarRuta(page, '/listo');
}

test.describe('horario de atención del asistente (LAU-29)', () => {
  test('el onboarding de un comercio lo carga con un horario típico y una sola franja para todos los días', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaCuandoAtiendeVentas(page);

    const tipico = visible(page.getByRole('button', { name: 'Lunes a sábado · 09:00–20:00' }));
    await tipico.click();
    await expect(tipico).toHaveAttribute('aria-pressed', 'true');
    await expect(visible(page.getByRole('button', { name: 'Sábado', exact: true }))).toHaveAttribute('aria-pressed', 'true');
    // La franja general cambia en todos los días a la vez.
    await visible(page.getByLabel('Hasta', { exact: true })).selectOption('19:00');
    await expect(tipico).toHaveAttribute('aria-pressed', 'false');
    await terminarVentas(page);

    expect(await horarioActual(context.request)).toMatchObject({
      activo: true,
      franjas: [...LABORABLES, 'sab'].map((dia) => ({ dia, desde: '09:00', hasta: '19:00' })),
    });
  });

  test('el onboarding acepta un horario nocturno que termina al día siguiente', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaCuandoAtiendeVentas(page);

    await visible(page.getByRole('button', { name: 'Todos los días · 09:00–21:00' })).click();
    await visible(page.getByLabel('Desde', { exact: true })).selectOption('19:00');
    await page.getByLabel('Hasta', { exact: true }).selectOption('07:00');
    await expect(page.getByText('Termina a las 07:00 del día siguiente')).toBeVisible();
    // Una franja nocturna no tiene mediodía que cortar.
    await expect(page.getByRole('button', { name: 'Cierra al mediodía' })).toHaveCount(0);
    await terminarVentas(page);

    expect(await horarioActual(context.request)).toMatchObject({
      activo: true,
      franjas: ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((dia) => ({ dia, desde: '19:00', hasta: '07:00' })),
      resumen: 'lunes a domingo de 19:00 a 07:00',
    });
  });

  test('con el switch prendido el comercio atiende siempre', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaCuandoAtiendeVentas(page);

    await visible(page.getByRole('switch', { name: 'Atender todos los días, todo el día' })).check();
    await expect(page.getByLabel('Zona horaria')).toHaveCount(0);
    await terminarVentas(page);

    expect((await horarioActual(context.request)).activo).toBe(false);
  });


  test('el onboarding lo pide, precargado con la franja de turnos, y queda activo', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await expect(preguntaInicial(page)).toBeVisible();
    await completarWizard(page, perfilProduccion(sufijo()));
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');

    expect(await horarioActual(context.request)).toEqual({
      activo: true,
      franjas: LABORABLES.map((dia) => ({ dia, desde: MANANA.desde, hasta: MANANA.hasta })),
      zona: 'America/Argentina/Buenos_Aires',
      resumen: 'lunes a viernes de 09:00 a 13:00',
    });
  });

  test('una cuenta sin el paso atiende siempre; en /cuenta lo limita, cambia la zona y lo vuelve a sacar', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    expect((await horarioActual(context.request)).activo).toBe(false);

    await page.goto('/cuenta');
    const seccion = page.getByRole('region', { name: 'Horario de atención' });
    await expect(seccion.getByText('Atiende siempre')).toBeVisible();
    const siempre = seccion.getByRole('checkbox', { name: 'Atender siempre, sin límite de horario' });
    await expect(siempre).toBeChecked();

    await siempre.uncheck();
    await seccion.getByLabel('Zona horaria').selectOption({ label: 'Uruguay' });
    // Arranca de lunes a viernes de 9 a 18; el sábado atiende a la mañana.
    await seccion.getByRole('checkbox', { name: 'Atiende el sábado' }).check();
    await seccion.getByLabel('Sábado: deja de atender').selectOption('13:00');
    // Un día que empieza y termina a la misma hora no se puede guardar (09:00 a 08:00 sí: es nocturno).
    await seccion.getByLabel('Lunes: deja de atender').selectOption('09:00');
    await expect(seccion.getByText('Tiene que cerrar después de abrir.')).toBeVisible();
    await expect(seccion.getByRole('button', { name: 'Guardar horario' })).toBeDisabled();
    await seccion.getByLabel('Lunes: deja de atender').selectOption('18:00');

    await seccion.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: el asistente ya usa este horario.');
    await expect(seccion.getByText('lunes a viernes de 09:00 a 18:00; sábado de 09:00 a 13:00')).toBeVisible();

    const guardado = await horarioActual(context.request);
    expect(guardado).toMatchObject({ activo: true, zona: 'America/Montevideo' });
    expect(guardado.franjas).toContainEqual({ dia: 'sab', desde: '09:00', hasta: '13:00' });

    // Sin restricción, el horario queda guardado para cuando lo vuelva a activar.
    await siempre.check();
    await seccion.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(seccion.getByRole('status')).toHaveText('Listo: el asistente ya usa este horario.');
    const sinLimite = await horarioActual(context.request);
    expect(sinLimite.activo).toBe(false);
    expect(sinLimite.franjas).toEqual(guardado.franjas);

    await page.reload();
    await siempre.uncheck();
    await expect(seccion.getByLabel('Zona horaria')).toHaveValue('America/Montevideo');
    await expect(seccion.getByRole('checkbox', { name: 'Atiende el sábado' })).toBeChecked();
  });

  test('la API rechaza un horario activo sin días o con una zona fuera de la lista', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const sinDias = await context.request.put(`${API_URL}/horario-atencion`, {
      data: { activo: true, franjas: [], zona: 'America/Argentina/Buenos_Aires' },
    });
    expect(sinDias.status()).toBe(400);
    const otraZona = await context.request.put(`${API_URL}/horario-atencion`, {
      data: { activo: true, franjas: [{ dia: 'lun', desde: '09:00', hasta: '18:00' }], zona: 'Asia/Tokyo' },
    });
    expect(otraZona.status()).toBe(400);
  });

  test('sin WhatsApp vinculado el estado lo dice y el header no muestra el del asistente', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    const res = await context.request.get(`${API_URL}/asistente/estado`);
    expect(await res.json()).toMatchObject({ prendido: false, motivo: 'sin_whatsapp' });

    await page.goto('/cuenta');
    await expect(visible(page.getByText('WhatsApp sin vincular'))).toBeVisible();
    await expect(page.getByRole('status', { name: /^Asistente|^Fuera de horario/ })).toHaveCount(0);
  });

  test('el header avisa si el asistente está prendido o fuera de horario', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    await fijarEstado(page, { prendido: true, motivo: null, hasta: '18:00', zona: 'America/Argentina/Buenos_Aires' });
    await page.goto('/cuenta');
    await expect(
      page.getByRole('status', { name: 'Asistente prendido, hasta las 18:00 (hora de Argentina)' }),
    ).toBeVisible();

    await page.unroute(`${API_URL}/asistente/estado`);
    await fijarEstado(page, {
      prendido: false,
      motivo: 'fuera_de_horario',
      vuelve: { dia: 'vie', desde: '09:00', enDias: 1 },
      zona: 'America/Montevideo',
    });
    await page.reload();
    await expect(
      page.getByRole('status', { name: 'Fuera de horario, vuelve mañana a las 09:00 (hora de Uruguay)' }),
    ).toBeVisible();
  });
});
