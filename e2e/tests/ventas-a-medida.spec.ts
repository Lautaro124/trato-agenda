import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, productoPorApi } from './ventas';

test.describe('productos a medida (LAU-22)', () => {
  test('se cargan las preguntas en dos bloques, se valida lo contradictorio y se guardan', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const producto = await crearProductoPorApi(context.request, { codigo: 'CORT-E2E', nombre: 'Cortina roller', precioCentavos: 6_000_000 });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Cortina roller' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Editar producto' });
    await dialogo.getByLabel('Este producto se hace a medida').check();

    // Encenderla deja una pregunta abierta en "Lo que el cliente ya tiene", lista para escribir.
    const tiene = dialogo.getByRole('region', { name: 'Lo que el cliente ya tiene' });
    await expect(tiene.getByLabel('Pregunta', { exact: true })).toBeFocused();
    await tiene.getByLabel('Pregunta', { exact: true }).fill('¿Qué medida tiene la ventana?');
    await tiene.getByLabel('Nueva opción').fill('Chica');
    await tiene.getByLabel('Nueva opción').press('Enter');
    await tiene.getByLabel('Nueva opción').fill('Mediana');
    await tiene.getByLabel('Nueva opción').press('Enter');
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
    await expect(pide.getByRole('button', { name: 'Editar pregunta: ¿De qué color la querés?' })).toBeVisible();

    // Una de respuesta escrita y opcional.
    await pide.getByRole('button', { name: 'Agregar pregunta a Lo que te pide' }).click();
    await pide.getByLabel('Pregunta', { exact: true }).fill('¿Algo más que tengamos que saber?');
    await pide.getByRole('radio', { name: 'Lo escribe' }).click();
    await pide.getByRole('switch', { name: 'Obligatoria' }).uncheck();
    await pide.getByRole('button', { name: 'Listo' }).click();

    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const tarjeta = page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Cortina roller' });
    await expect(tarjeta.getByText('A medida')).toBeVisible();
    await expect(tarjeta.getByText('3 preguntas para presupuestar')).toBeVisible();

    expect((await productoPorApi(context.request, producto.id)).solicitud).toEqual({
      preguntas: [
        { texto: '¿Qué medida tiene la ventana?', sobre: 'tiene', opciones: ['Chica', 'Mediana', 'Grande'], textoLibre: true, obligatoria: true },
        { texto: '¿De qué color la querés?', sobre: 'solicita', opciones: ['Blanco', 'Negro'], textoLibre: false, obligatoria: true },
        { texto: '¿Algo más que tengamos que saber?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: false },
      ],
    });

    // Al reabrir vuelve todo plegado en su bloque; apagarla las borra.
    await page.getByRole('button', { name: 'Editar Cortina roller' }).click();
    await expect(pide.getByRole('button', { name: 'Editar pregunta: ¿Algo más que tengamos que saber?' })).toContainText(
      'Opcional',
    );
    await expect(tiene.getByRole('button', { name: /^Editar pregunta:/ })).toHaveCount(1);
    await dialogo.getByLabel('Este producto se hace a medida').uncheck();
    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();
    await expect(tarjeta.getByText('A medida')).toBeHidden();
    expect((await productoPorApi(context.request, producto.id)).solicitud).toBeNull();
  });

  test('en el celular se habilita y se guarda con una pregunta escrita @movil', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const producto = await crearProductoPorApi(context.request, { codigo: 'MESA-E2E', nombre: 'Mesa de roble', precioCentavos: 30_000_000 });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Mesa de roble' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Editar producto' });
    await dialogo.getByLabel('Este producto se hace a medida').check();
    await dialogo.getByLabel('Pregunta', { exact: true }).fill('¿Qué medidas tiene el comedor?');
    await dialogo.getByRole('radio', { name: 'Lo escribe' }).click();
    // Sin apretar "Listo": guardar también la toma.
    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    expect((await productoPorApi(context.request, producto.id)).solicitud).toEqual({
      preguntas: [{ texto: '¿Qué medidas tiene el comedor?', sobre: 'tiene', opciones: [], textoLibre: true, obligatoria: true }],
    });
  });
});
