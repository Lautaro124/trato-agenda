import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, nuevoProducto } from './ventas';

test.describe('una cuenta que vende de stock y a medida', () => {
  test('carga los dos tipos desde /productos/nuevo, cada uno en su pantalla', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    const deStock = await nuevoProducto(page, 'stock');
    await deStock.getByLabel('Código', { exact: true }).fill('MATE-E2E');
    await deStock.getByLabel('Nombre', { exact: true }).fill('Mate de calabaza');
    await deStock.getByLabel(/^Precio/).first().fill('8.000');
    await deStock.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    const aMedida = await nuevoProducto(page, 'a-medida');
    await aMedida.getByLabel('Nombre', { exact: true }).fill('Mesa a medida');
    await aMedida.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(page).toHaveURL(/\/productos$/);

    const tarjetas = page.getByRole('list', { name: 'Productos' }).getByRole('listitem');
    await expect(tarjetas.filter({ hasText: 'Mate de calabaza' }).getByRole('form', { name: 'Precio y stock de Mate de calabaza' })).toBeVisible();
    await expect(tarjetas.filter({ hasText: 'Mesa a medida' }).getByText('A medida', { exact: true })).toBeVisible();

    // Editar abre el formulario que corresponde a cada uno.
    await page.getByRole('button', { name: 'Editar Mesa a medida' }).click();
    await expect(page.getByRole('form', { name: 'Editar producto a medida' })).toBeVisible();
    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Mate de calabaza' }).click();
    await expect(page.getByRole('form', { name: 'Editar producto' })).toBeVisible();
  });

  test('el asistente cotiza lo a medida y vende lo de stock en la misma charla', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const producto = await context.request.post(`${API_URL}/productos`, {
      data: { codigo: 'MESA', nombre: 'Mesa a medida', descripcion: '', solicitud: { preguntas: [] }, materiales: [] },
    });
    expect(producto.status(), await producto.text()).toBe(201);
    await crearProductoPorApi(context.request, { codigo: 'MATE', nombre: 'Mate de calabaza', precioCentavos: 800_000 });

    const decir = async (message: string) => {
      const res = await context.request.post(`${API_URL}/conversation/test`, { data: { message } });
      expect(res.ok(), await res.text()).toBe(true);
      return ((await res.json()) as { reply: string }).reply;
    };
    await decir('mesa');
    const solicitud = await decir('quiero una mesa de 1,80 x 0,90 para fin de mes, soy Ana');
    expect(solicitud).toContain('Solicitud anotada');
    expect(solicitud).not.toContain('Pedido creado');

    await decir('mate de calabaza');
    const compra = await decir('quiero 1 mate, soy Ana');
    expect(compra).toContain('Pedido creado');

    const avisos = await context.request.get(`${API_URL}/notificaciones`);
    const { notificaciones } = (await avisos.json()) as {
      notificaciones: Array<{ titulo: string; cuerpo: string; enlace: string | null }>;
    };
    const aviso = notificaciones.find((uno) => uno.titulo === '[Prueba] Para cotizar: Mesa a medida');
    expect(aviso?.cuerpo).toContain('pidió un presupuesto de "Mesa a medida"');
    expect(aviso?.cuerpo).toContain('quiero una mesa de 1,80 x 0,90 para fin de mes, soy Ana');
    expect(aviso?.enlace).toMatch(/^\/ventas\?venta=/);
  });
});
