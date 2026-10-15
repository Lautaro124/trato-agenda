import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, productoPorApi, type ProductoE2E } from './ventas';

/** PNG de 1 × 1, como en ventas-fotos.spec.ts. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const QUE_HACE = 'Hacemos cortinas y persianas a medida para casas y oficinas. Vamos a medir a domicilio.';

test.describe('productos a medida (LAU-22)', () => {
  test('una cuenta a pedido carga sus productos de a uno, con el formulario a medida', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { modalidadVenta: 'pedido', queHace: QUE_HACE });

    await page.goto('/productos');
    // Sin planillas: los productos a medida se cargan a mano.
    await expect(page.getByRole('button', { name: 'Importar planilla' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cargar mi primer producto' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nuevo producto a medida' });
    // Nada de stock, variantes ni descuento.
    await expect(dialogo.getByLabel('Stock (unidades)')).toHaveCount(0);
    await expect(dialogo.getByText('Este producto tiene descuento')).toHaveCount(0);

    // El código se arma solo con el nombre, y se puede cambiar.
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Cortina roller');
    await expect(dialogo.getByText('CORTINA-ROLLER')).toBeVisible();
    await dialogo.getByRole('button', { name: 'Cambiar código' }).click();
    await expect(dialogo.getByLabel('Código')).toHaveValue('CORTINA-ROLLER');
    await dialogo.getByLabel('Código').fill('CORT-E2E');

    // Materiales: escritos con Enter o tocando una idea.
    const materiales = dialogo.getByRole('region', { name: 'Materiales' });
    await materiales.getByLabel('Nuevo material').fill('Blackout');
    await materiales.getByLabel('Nuevo material').press('Enter');
    await materiales.getByRole('button', { name: '+ Tela' }).click();
    await expect(materiales.getByRole('list', { name: 'Materiales cargados' }).getByRole('listitem')).toHaveText(['Blackout', 'Tela']);

    // Precio "desde": sólo si el dueño quiere darlo.
    await expect(dialogo.getByLabel('Precio desde')).toHaveCount(0);
    await dialogo.getByText('Sí, un “desde”').click();
    await dialogo.getByLabel('Precio desde').fill('60.000');

    // Preguntas: opcionales; cada una es lo que pregunta el asistente y, si quiere, las opciones que da.
    await expect(dialogo.getByText('Sin preguntas propias, tu asistente pregunta lo básico')).toBeVisible();
    await dialogo.getByRole('button', { name: '+ Agregar pregunta' }).click();
    const primera = dialogo.getByRole('group', { name: 'Pregunta 1' });
    await primera.getByLabel('Tu asistente pregunta').fill('¿Qué medida tiene la ventana?');
    await dialogo.getByRole('button', { name: '+ Agregar pregunta' }).click();
    const segunda = dialogo.getByRole('group', { name: 'Pregunta 2' });
    await segunda.getByLabel('Tu asistente pregunta').fill('¿De qué color la querés?');
    for (const opcion of ['Blanco', 'Negro']) {
      await segunda.getByLabel('Nueva opción').fill(opcion);
      await segunda.getByLabel('Nueva opción').press('Enter');
    }
    await segunda.getByLabel('Nueva opción').fill('Gris');
    await segunda.getByRole('button', { name: 'Agregar', exact: true }).click();
    await segunda.getByRole('button', { name: 'Quitar Gris' }).click();
    // Una idea suma la pregunta ya escrita; el pie avisa lo que falta mientras tanto.
    await dialogo.getByRole('button', { name: '+ Agregar pregunta' }).click();
    await expect(dialogo.getByText(/^Falta: escribir 1 pregunta$/)).toBeVisible();
    await dialogo.getByRole('group', { name: 'Pregunta 3' }).getByRole('button', { name: 'Quitar pregunta 3' }).click();
    await dialogo.getByRole('button', { name: '¿Para cuándo lo necesitás?' }).click();
    await dialogo.getByRole('group', { name: 'Pregunta 3' }).getByLabel('La necesito sí o sí para cotizar').uncheck();
    await expect(dialogo.getByText('Listo para guardar')).toBeVisible();

    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const tarjeta = page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Cortina roller' });
    await expect(tarjeta.getByText('A medida')).toBeVisible();
    await expect(tarjeta.getByText('Desde $ 60.000')).toBeVisible();
    await expect(tarjeta.getByText('En Blackout · Tela')).toBeVisible();
    await expect(tarjeta.getByText('3 preguntas para hacer')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Precio y stock de Cortina roller' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Promociones' })).toHaveCount(0);

    const listado = await context.request.get(`${API_URL}/productos`);
    const [guardado] = ((await listado.json()) as { productos: ProductoE2E[] }).productos;
    expect(guardado).toMatchObject({
      codigo: 'CORT-E2E',
      variantes: [],
      precioReferenciaCentavos: 6_000_000,
      materiales: ['Blackout', 'Tela'],
    });
    // En el orden en que se cargaron; sin opciones se responde con palabras, con dos o más se elige.
    expect(guardado.solicitud).toEqual({
      preguntas: [
        { texto: '¿Qué medida tiene la ventana?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true },
        { texto: '¿De qué color la querés?', sobre: 'solicita', opciones: ['Blanco', 'Negro'], textoLibre: false, obligatoria: true },
        { texto: '¿Para cuándo lo necesitás?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: false },
      ],
    });

    // Al reabrir está todo a la vista; sin precio "desde" queda a cotizar.
    await page.getByRole('button', { name: 'Editar Cortina roller' }).click();
    const edicion = page.getByRole('dialog', { name: 'Editar producto a medida' });
    await expect(edicion.getByRole('group', { name: 'Pregunta 3' }).getByLabel('Tu asistente pregunta')).toHaveValue(
      '¿Para cuándo lo necesitás?',
    );
    await expect(edicion.getByText('CORT-E2E')).toBeVisible();
    await edicion.getByText('No, siempre lo cotizo').click();
    await edicion.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(edicion).toBeHidden();
    await expect(tarjeta.getByText('Precio a cotizar')).toBeVisible();
    expect((await productoPorApi(context.request, guardado.id)).precioReferenciaCentavos).toBeNull();

    // La API tampoco acepta una planilla.
    const importacion = await context.request.post(`${API_URL}/productos/importar`, {
      data: { filas: [{ codigo: 'X', nombre: 'Algo', precio: '1' }], confirmar: false },
    });
    expect(importacion.status()).toBe(409);
  });

  test('una cuenta con stock tiene sólo el formulario de stock', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'MATE-STOCK', nombre: 'Mate de calabaza', precioCentavos: 800_000 });

    await page.goto('/productos');
    await expect(page.getByRole('button', { name: 'Importar planilla' })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nuevo producto' });
    await expect(dialogo.getByLabel('Stock (unidades)')).toBeVisible();
    await expect(dialogo.getByText('Preguntas para hacer')).toHaveCount(0);
    await expect(dialogo.getByLabel('Precio desde')).toHaveCount(0);
  });

  test('en el celular se carga un producto a medida sin preguntas y con la foto elegida antes de guardar @movil', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { modalidadVenta: 'pedido', queHace: QUE_HACE });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Nuevo producto a medida' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nuevo producto a medida' });
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Mesa de roble');
    // Un material tipeado sin Enter también se guarda.
    await dialogo.getByLabel('Nuevo material').fill('Roble macizo');
    // La foto se elige antes de que el producto exista y se sube al guardar.
    await dialogo.getByLabel('Elegir foto del producto').setInputFiles({ name: 'mesa.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialogo.getByRole('img', { name: 'Foto del producto' })).toBeVisible();
    // La vista previa va plegada en el celular; con materiales y sin preguntas, el asistente pregunta el material.
    await dialogo.getByText('Ver cómo pregunta tu asistente').click();
    const vistaPrevia = dialogo.locator('details');
    await expect(vistaPrevia.getByText('¡Hola! Sí, lo hacemos a medida en Roble macizo.', { exact: false })).toBeVisible();
    await expect(vistaPrevia.getByText('¿En qué material lo querés?').first()).toBeVisible();
    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const listado = await context.request.get(`${API_URL}/productos`);
    const [guardado] = ((await listado.json()) as { productos: ProductoE2E[] }).productos;
    expect(guardado).toMatchObject({
      codigo: 'MESA-DE-ROBLE',
      variantes: [],
      precioReferenciaCentavos: null,
      materiales: ['Roble macizo'],
      solicitud: { preguntas: [] },
    });
    expect(guardado.imagenActualizada).toBeTruthy();
    await expect(
      page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Mesa de roble' }).getByText('Sin preguntas propias'),
    ).toBeVisible();
  });
});
