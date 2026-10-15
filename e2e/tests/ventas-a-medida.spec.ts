import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, productoPorApi, type ProductoE2E } from './ventas';

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

    await dialogo.getByLabel('Código').fill('CORT-E2E');
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Cortina roller');
    await dialogo.getByLabel('Precio desde').fill('60.000');

    // Arranca con una pregunta lista en "Lo que el cliente ya tiene".
    const tiene = dialogo.getByRole('region', { name: 'Lo que el cliente ya tiene' });
    await tiene.getByLabel('Pregunta', { exact: true }).fill('¿Qué medida tiene la ventana?');
    for (const opcion of ['Chica', 'Mediana']) {
      await tiene.getByLabel('Nueva opción').fill(opcion);
      await tiene.getByLabel('Nueva opción').press('Enter');
    }
    await tiene.getByLabel('Nueva opción').fill('Grande');
    await tiene.getByRole('button', { name: 'Agregar', exact: true }).click();
    await tiene.getByLabel('Si ninguna le sirve, puede escribir otra respuesta').check();
    await tiene.getByRole('button', { name: 'Listo' }).click();
    await expect(tiene.getByRole('button', { name: 'Editar pregunta: ¿Qué medida tiene la ventana?' })).toBeVisible();

    // Una sola opción sin texto libre no deja nada para elegir: no se pliega y dice por qué.
    const pide = dialogo.getByRole('region', { name: 'Lo que te pide' });
    await pide.getByRole('button', { name: 'Agregar pregunta a Lo que te pide' }).click();
    await pide.getByLabel('Pregunta', { exact: true }).fill('¿De qué color la querés?');
    await pide.getByLabel('Nueva opción').fill('Blanco');
    await pide.getByLabel('Nueva opción').press('Enter');
    await pide.getByRole('button', { name: 'Listo' }).click();
    await expect(pide.getByRole('alert')).toHaveText(/Con una sola opción no hay nada para elegir/);
    await pide.getByLabel('Nueva opción').fill('Negro');
    await pide.getByLabel('Nueva opción').press('Enter');
    await pide.getByRole('button', { name: 'Listo' }).click();

    await pide.getByRole('button', { name: 'Agregar pregunta a Lo que te pide' }).click();
    await pide.getByLabel('Pregunta', { exact: true }).fill('¿Algo más que tengamos que saber?');
    await pide.getByRole('radio', { name: 'Lo escribe' }).click();
    await pide.getByRole('switch', { name: 'Obligatoria' }).uncheck();
    await pide.getByRole('button', { name: 'Listo' }).click();

    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const tarjeta = page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Cortina roller' });
    await expect(tarjeta.getByText('A medida')).toBeVisible();
    await expect(tarjeta.getByText('Desde $ 60.000')).toBeVisible();
    await expect(tarjeta.getByText('3 preguntas para presupuestar')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Precio y stock de Cortina roller' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Promociones' })).toHaveCount(0);

    const listado = await context.request.get(`${API_URL}/productos`);
    const [guardado] = ((await listado.json()) as { productos: ProductoE2E[] }).productos;
    expect(guardado).toMatchObject({ variantes: [], precioReferenciaCentavos: 6_000_000 });
    expect(guardado.solicitud).toEqual({
      preguntas: [
        { texto: '¿Qué medida tiene la ventana?', sobre: 'tiene', opciones: ['Chica', 'Mediana', 'Grande'], textoLibre: true, obligatoria: true },
        { texto: '¿De qué color la querés?', sobre: 'solicita', opciones: ['Blanco', 'Negro'], textoLibre: false, obligatoria: true },
        { texto: '¿Algo más que tengamos que saber?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: false },
      ],
    });

    // Al reabrir vuelve todo plegado en su bloque; sin precio "desde" queda a cotizar.
    await page.getByRole('button', { name: 'Editar Cortina roller' }).click();
    const edicion = page.getByRole('dialog', { name: 'Editar producto a medida' });
    await expect(
      edicion.getByRole('region', { name: 'Lo que te pide' }).getByRole('button', { name: 'Editar pregunta: ¿Algo más que tengamos que saber?' }),
    ).toContainText('Opcional');
    await edicion.getByLabel('Precio desde').fill('');
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
    await expect(dialogo.getByText('Preguntas para presupuestar')).toHaveCount(0);
    await expect(dialogo.getByLabel('Precio desde')).toHaveCount(0);
  });

  test('en el celular se carga un producto a medida con una pregunta escrita @movil', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { modalidadVenta: 'pedido', queHace: QUE_HACE });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Nuevo producto a medida' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nuevo producto a medida' });
    await dialogo.getByLabel('Código').fill('MESA-E2E');
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Mesa de roble');
    await dialogo.getByLabel('Pregunta', { exact: true }).fill('¿Qué medidas tiene el comedor?');
    await dialogo.getByRole('radio', { name: 'Lo escribe' }).click();
    // Sin apretar "Listo": guardar también la toma.
    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const listado = await context.request.get(`${API_URL}/productos`);
    const [guardado] = ((await listado.json()) as { productos: ProductoE2E[] }).productos;
    expect(guardado).toMatchObject({ codigo: 'MESA-E2E', variantes: [], precioReferenciaCentavos: null });
    expect(guardado.solicitud).toEqual({
      preguntas: [{ texto: '¿Qué medidas tiene el comedor?', sobre: 'tiene', opciones: [], textoLibre: true, obligatoria: true }],
    });
  });
});
