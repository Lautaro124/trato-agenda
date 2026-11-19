import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

type PreguntaGuardada = {
  id: string;
  texto: string;
  tipo: 'opciones' | 'texto';
  obligatoria: boolean;
  alcance: 'global' | 'producto';
  productos: string[];
  dependeDe: { preguntaId: string; siRespuestas: string[] } | null;
  opciones: Array<{ id: string; texto: string; soloSi: string[] }>;
  otra: { etiqueta: string } | null;
  ayuda: string | null;
};

test.describe('preguntas del pedido (LAU-100)', () => {
  test('el dueño arma una pregunta por producto con colores según la tela y una global de texto libre', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const sillon = await crearProductoPorApi(context.request, { codigo: 'SILLON-E2E', nombre: 'Sillón Nube', precioCentavos: 100_000, stock: 3 });

    await page.goto('/preguntas');
    await expect(page.getByRole('heading', { name: 'Preguntas', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Crear la primera' }).click();

    // Tela: sólo para el sillón, con dos opciones.
    await page.getByLabel('Pregunta', { exact: true }).fill('¿Qué tela querés?');
    await page.getByText('Sólo con ciertos productos').click();
    await page.getByLabel('Agregar producto').fill('nube');
    await page.getByRole('button', { name: '+ Sillón Nube' }).click();
    await expect(page.getByRole('list', { name: 'Productos elegidos' }).getByText('Sillón Nube')).toBeVisible();
    for (const tela of ['Lino', 'Pana']) {
      await page.getByLabel(/^Nueva opción/).fill(tela);
      await page.getByLabel(/^Nueva opción/).press('Enter');
    }

    // Color: depende de la tela; Lino ofrece Verde y Rojo, Pana sólo Gris; acepta un pedido especial.
    await page.getByRole('button', { name: 'Nueva pregunta' }).click();
    await page.getByLabel('Pregunta', { exact: true }).fill('¿Qué color querés?');
    await page.getByLabel('¿Cuándo se pregunta?').selectOption({ label: 'Después de «¿Qué tela querés?»' });
    await expect(page.getByText('En los mismos que «¿Qué tela querés?».')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lino', pressed: true })).toBeVisible();
    for (const color of ['Verde', 'Rojo']) {
      await page.getByLabel('Nueva opción para lino').fill(color);
      await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Pana' }).click();
    await page.getByLabel('Nueva opción para pana').fill('Gris');
    await page.getByLabel('Nueva opción para pana').press('Enter');
    await page.getByRole('switch', { name: /Aceptar otra opción/ }).check();
    // A 1280px la vista previa es una pestaña del editor.
    await page.getByRole('tab', { name: 'Así lo ve el cliente' }).click();
    await expect(page.getByText('Nota en el pedido', { exact: true })).toBeVisible();

    // Global de texto libre, que se puede saltear.
    await page.getByRole('button', { name: 'Nueva pregunta' }).click();
    await page.getByLabel('Pregunta', { exact: true }).fill('¿Querés agregar algo más al pedido?');
    await page.getByText('Texto libre', { exact: true }).click();
    await page.getByLabel('Ayuda para el cliente (opcional)').fill('Ej.: es para regalo');
    await page.getByRole('switch', { name: /Se puede saltear/ }).check();

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Todo guardado.')).toBeVisible();

    const res = await context.request.get(`${API_URL}/preguntas`);
    expect(res.ok(), await res.text()).toBe(true);
    const { preguntas } = (await res.json()) as { preguntas: PreguntaGuardada[] };
    expect(preguntas.map((p) => p.texto)).toEqual(['¿Qué tela querés?', '¿Qué color querés?', '¿Querés agregar algo más al pedido?']);
    const [tela, color, aclaracion] = preguntas;
    expect(tela).toMatchObject({ alcance: 'producto', productos: [sillon.id], tipo: 'opciones' });
    const lino = tela.opciones.find((o) => o.texto === 'Lino')?.id;
    const pana = tela.opciones.find((o) => o.texto === 'Pana')?.id;
    expect(color).toMatchObject({
      alcance: 'producto',
      productos: [sillon.id],
      dependeDe: { preguntaId: tela.id, siRespuestas: [] },
      otra: { etiqueta: 'Personalizar' },
    });
    expect(color.opciones.map((o) => [o.texto, o.soloSi])).toEqual([
      ['Verde', [lino]],
      ['Rojo', [lino]],
      ['Gris', [pana]],
    ]);
    expect(aclaracion).toMatchObject({ tipo: 'texto', alcance: 'global', obligatoria: false, ayuda: 'Ej.: es para regalo' });

    // Al volver, se ve lo guardado; el formulario del producto las muestra.
    await page.reload();
    await expect(page.getByRole('button', { name: /¿Qué color querés\?/ })).toBeVisible();
    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Sillón Nube' }).click();
    const seccion = page.getByRole('region', { name: 'Preguntas al pedir' });
    await expect(seccion.getByText('¿Qué tela querés?')).toBeVisible();
    await expect(seccion.getByText('hay 1 pregunta para todos los pedidos', { exact: false })).toBeVisible();
  });

  test('la API rechaza preguntas mal formadas o con productos ajenos', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const opcionUnica = await context.request.put(`${API_URL}/preguntas`, {
      data: { preguntas: [{ id: 'p1', texto: '¿Color?', tipo: 'opciones', alcance: 'global', opciones: [] }] },
    });
    expect(opcionUnica.status()).toBe(422);
    const ajeno = await context.request.put(`${API_URL}/preguntas`, {
      data: {
        preguntas: [
          { id: 'p1', texto: '¿Talle?', tipo: 'opciones', alcance: 'producto', productos: ['no-es-mio'], opciones: [{ id: 'o1', texto: 'S' }] },
        ],
      },
    });
    expect(ajeno.status()).toBe(422);
  });
});
