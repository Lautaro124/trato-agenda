import type { Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { botonContinuar, elegirAsistente, preguntaInicial } from './onboarding';

async function armarAsistenteDeVentas(page: Page, opciones: { direccion?: string } = {}): Promise<string> {
  const negocio = `Mates E2E ${sufijo()}`;
  await page.goto('/contanos');
  await elegirAsistente(page, 'ventas');
  // Ventas no pregunta turnos ni horarios, sí por el local: son cuatro pasos.
  await expect(visible(page.getByText('Paso 2 de 4'))).toBeVisible();
  await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(negocio);
  await botonContinuar(page).click();
  // "Tu local": sin tocar nada queda "vendo sólo online".
  await expect(visible(page.getByRole('radio', { name: 'No, vendo sólo online' }))).toHaveAttribute('aria-checked', 'true');
  if (opciones.direccion) {
    await visible(page.getByRole('radio', { name: 'Sí, tengo local' })).click();
    await visible(page.getByLabel('Dirección')).fill(opciones.direccion);
    // Arranca de lunes a viernes; el sábado abre a la mañana.
    await visible(page.getByRole('checkbox', { name: 'Sábado' })).check();
    await visible(page.getByLabel('Sábado: cierra')).selectOption('13:00');
    await visible(page.getByRole('checkbox', { name: 'Se pueden retirar las compras en el local' })).check();
  }
  await botonContinuar(page).click();
  await visible(page.getByLabel('Nombre del asistente')).fill('Sol');
  // La vista previa del saludo usa lo que se escribió.
  await expect(visible(page.getByText(`Hola, soy Sol, el asistente de ${negocio}.`, { exact: false }))).toBeVisible();
  await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
  await esperarRuta(page, '/listo');
  return negocio;
}

test.describe('onboarding de un comercio', () => {
  test('cambiar de tipo en el primer paso no pierde el nombre del negocio', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await expect(preguntaInicial(page)).toBeVisible();
    await elegirAsistente(page, 'ventas');
    await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill('Mates del Sur');

    // "Atrás" en escritorio, la flecha en el celular.
    await visible(page.getByRole('button', { name: /^(Atrás|Volver al paso anterior)$/ })).first().click();
    await expect(page.getByRole('radio', { name: /Vender productos/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: /Agendar turnos/ }).click();
    await expect(visible(page.getByText('Paso 1 de 5'))).toBeVisible();

    await botonContinuar(page).click();
    await expect(visible(page.getByLabel('¿Cómo se llama tu negocio?'))).toHaveValue('Mates del Sur');
  });

  test('elige vender, arma su asistente y ve el panel de ventas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await armarAsistenteDeVentas(page);

    const agente = (await agenteActual(context.request)) as unknown as {
      tipoAsistente: string;
      allowedActions: string[];
      local: unknown;
    };
    expect(agente.tipoAsistente).toBe('ventas');
    expect(agente.local).toEqual({ tieneLocal: false, horarios: [], retiroEnLocal: false });
    expect(agente.allowedActions).toEqual(expect.arrayContaining(['buscar_productos', 'crear_pedido']));

    // La navegación de una cuenta de ventas: catálogo y ventas, sin calendario.
    await page.goto('/inicio');
    await expect(page.getByRole('region', { name: 'Tu tienda' })).toBeVisible();
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Productos' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Calendario' })).toHaveCount(0);

    // Lo propio de la agenda no aplica: /reuniones manda al catálogo.
    await page.goto('/reuniones');
    await esperarRuta(page, '/productos');

    // Y una cuenta no cambia de tipo después.
    const res = await context.request.post(`${API_URL}/agents/generate`, {
      data: {
        tipoTitular: 'negocio',
        nombreTitular: 'Otra cosa',
        tipoUso: 'consultorio',
        tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
        horaDesde: '09:00',
        horaHasta: '18:00',
        nombreBot: 'Tati',
      },
    });
    expect(res.status()).toBe(409);
  });

  test('carga su local en el alta y queda guardado con sus horarios', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await armarAsistenteDeVentas(page, { direccion: 'Av. Corrientes 1234' });

    const agente = (await agenteActual(context.request)) as unknown as { local: unknown };
    expect(agente.local).toEqual({
      tieneLocal: true,
      direccion: 'Av. Corrientes 1234',
      horarios: [
        ...['lun', 'mar', 'mie', 'jue', 'vie'].map((dia) => ({ dia, desde: '09:00', hasta: '18:00' })),
        { dia: 'sab', desde: '09:00', hasta: '13:00' },
      ],
      retiroEnLocal: true,
    });
  });

  test('@movil el mismo formulario, en el teléfono', async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await armarAsistenteDeVentas(page);

    await page.goto('/inicio');
    const barra = page.getByRole('navigation').last();
    await expect(barra.getByRole('link', { name: 'Productos' })).toBeVisible();
    await expect(barra.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await expect(barra.getByRole('link', { name: 'Calendario' })).toHaveCount(0);
  });
});
