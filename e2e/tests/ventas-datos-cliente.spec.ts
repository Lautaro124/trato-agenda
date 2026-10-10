import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { botonContinuar, elegirAsistente } from './onboarding';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

/** El chat de prueba por API, para los tests que no prueban la pantalla del chat. */
async function decirle(request: APIRequestContext, message: string): Promise<string> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { reply: string }).reply;
}

type DatosGuardados = {
  haceEnvios: boolean;
  datosCliente: Array<{ tipo: string; etiqueta: string; obligatorio: boolean }>;
};

test.describe('datos que el asistente de ventas le pide al cliente', () => {
  test('se eligen en el onboarding y se editan después en Cuenta', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await elegirAsistente(page, 'ventas');
    await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(`Mates E2E ${sufijo()}`);
    await botonContinuar(page).click();

    await page.getByRole('radio', { name: 'Sí, hago envíos' }).click();
    await page.getByRole('button', { name: 'Código postal', exact: true }).click();
    await page.getByRole('button', { name: 'Dirección', exact: true }).click();
    // Un dato tildado arranca obligatorio; la provincia la deja opcional.
    await page.getByRole('button', { name: 'Provincia', exact: true }).click();
    await page.getByRole('button', { name: 'Provincia obligatorio' }).click();
    await page.getByLabel('Nuevo dato del cliente').fill('Entre calles');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    // La vista previa muestra cómo los pide.
    await expect(visible(page.getByText('¿Te lo envío o lo retirás?', { exact: false }))).toBeVisible();
    await botonContinuar(page).click();

    await visible(page.getByLabel('Nombre del asistente')).fill('Sol');
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');

    const agente = (await agenteActual(context.request)) as unknown as DatosGuardados;
    expect(agente.haceEnvios).toBe(true);
    expect(agente.datosCliente).toEqual([
      { tipo: 'codigoPostal', etiqueta: 'Código postal', obligatorio: true },
      { tipo: 'direccion', etiqueta: 'Dirección', obligatorio: true },
      { tipo: 'provincia', etiqueta: 'Provincia', obligatorio: false },
      { tipo: 'personalizado', etiqueta: 'Entre calles', obligatorio: true },
    ]);

    // En Cuenta: quita "Entre calles" y deja de hacer envíos.
    await page.goto('/cuenta');
    const seccion = page.getByRole('region', { name: 'Datos que pide tu asistente' });
    await seccion.getByRole('button', { name: 'Quitar Entre calles' }).click();
    await seccion.getByRole('radio', { name: 'No hago envíos' }).click();
    await seccion.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(seccion.getByText('Listo: tu asistente ya pide estos datos.')).toBeVisible();

    const editado = (await agenteActual(context.request)) as unknown as DatosGuardados;
    expect(editado.haceEnvios).toBe(false);
    expect(editado.datosCliente.map((campo) => campo.etiqueta)).toEqual(['Código postal', 'Dirección', 'Provincia']);
  });

  test('con envío, el pedido guarda los datos y el dueño los ve en Ventas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, {
      haceEnvios: true,
      datosCliente: [
        { tipo: 'codigoPostal', obligatorio: true },
        { tipo: 'personalizado', etiqueta: 'Entre calles', obligatorio: false },
      ],
    });
    await crearProductoPorApi(context.request, { codigo: 'MATE-DC', nombre: 'Mate imperial', precioCentavos: 900_000, stock: 3 });

    await decirle(context.request, '¿tenés mate imperial?');
    // Sin decir si es envío o retiro, no hay pedido.
    expect(await decirle(context.request, 'quiero 1, soy Ana')).toContain('si lo quiere con envío o si lo retira');
    // Con envío pero sin el código postal (obligatorio), tampoco.
    expect(await decirle(context.request, 'quiero 1, soy Ana con envío')).toContain('faltan "Código postal"');
    expect(
      await decirle(context.request, 'quiero 1, soy Ana con envío; Código postal: 1414; Entre calles: Thames y Uriarte'),
    ).toContain('Pedido creado para "Ana"');

    await page.goto('/ventas');
    await page.getByLabel('Incluir pedidos del chat de prueba').check();
    await page.getByRole('list', { name: 'Ventas' }).getByRole('button', { name: /Ana/ }).click();
    const detalle = page.getByRole('dialog');
    await expect(detalle.getByText('Con envío')).toBeVisible();
    await expect(detalle.getByText('1414')).toBeVisible();
    await expect(detalle.getByText('Thames y Uriarte')).toBeVisible();
  });
});
