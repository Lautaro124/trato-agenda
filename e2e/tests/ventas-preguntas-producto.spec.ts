import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, nuevoProducto } from './ventas';

type ConPreguntas = { codigo: string; preguntas: unknown };

test.describe('preguntas al pedir un producto', () => {
  test('el dueño las carga en el formulario y quedan guardadas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const preguntasDe = async (codigo: string) => {
      const res = await context.request.get(`${API_URL}/productos`);
      expect(res.ok(), await res.text()).toBe(true);
      const { productos } = (await res.json()) as { productos: ConPreguntas[] };
      return productos.find((producto) => producto.codigo === codigo)?.preguntas;
    };

    await page.goto('/productos');
    const formulario = await nuevoProducto(page);
    await formulario.getByLabel('Código', { exact: true }).fill('REMERA-E2E');
    await formulario.getByLabel('Nombre', { exact: true }).fill('Remera básica');
    await formulario.getByLabel(/^Precio/).first().fill('18.500');

    const seccion = formulario.getByRole('region', { name: 'Preguntas al pedir' });
    await seccion.getByRole('button', { name: 'Agregar pregunta' }).click();
    await seccion.getByLabel('Qué le pregunta el asistente').fill('¿Qué talle querés?');

    // Una de opciones necesita al menos dos.
    await seccion.getByLabel('Nueva opción de la pregunta 1').fill('S');
    await seccion.getByRole('button', { name: 'Agregar', exact: true }).click();
    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(formulario.getByText('La pregunta 1 necesita al menos 2 opciones.')).toBeVisible();

    await seccion.getByLabel('Nueva opción de la pregunta 1').fill('M');
    await seccion.getByLabel('Nueva opción de la pregunta 1').press('Enter');
    await expect(seccion.getByText('M', { exact: true })).toBeVisible();

    await seccion.getByRole('button', { name: 'Agregar pregunta' }).click();
    await seccion.getByLabel('Qué le pregunta el asistente').nth(1).fill('¿Querés un nombre estampado?');
    await seccion.getByText('Texto libre', { exact: true }).nth(1).click();
    await seccion.getByRole('checkbox', { name: /Obligatoria/ }).nth(1).uncheck();

    await formulario.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);
    expect(await preguntasDe('REMERA-E2E')).toEqual([
      { texto: '¿Qué talle querés?', tipo: 'opciones', opciones: ['S', 'M'], obligatoria: true },
      { texto: '¿Querés un nombre estampado?', tipo: 'texto', opciones: [], obligatoria: false },
    ]);

    // Al volver a editarlo, se ve lo guardado.
    await page.getByRole('button', { name: 'Editar Remera básica' }).click();
    await expect(page.getByLabel('Qué le pregunta el asistente').first()).toHaveValue('¿Qué talle querés?');
    await expect(page.getByRole('radio', { name: 'Texto libre' }).nth(1)).toBeChecked();
  });

  test('la API rechaza preguntas mal formadas', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const res = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'MALA-E2E',
        nombre: 'Mala',
        precioCentavos: 1000,
        preguntas: [{ texto: '¿Color?', tipo: 'opciones', opciones: ['Rojo'], obligatoria: true }],
      },
    });
    expect(res.status()).toBe(400);
  });
});
