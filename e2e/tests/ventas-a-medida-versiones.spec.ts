/**
 * Versiones con precio fijo de un producto a medida: el dueño las carga con
 * su foto, el asistente las ofrece mandando las fotos solo, una versión
 * pedida tal cual sale con su precio y su cobro, y una con cambios queda
 * para cotizar con esa versión de base. Desde el banco de pruebas del Home
 * (`/conversation/test`).
 */
import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, productoPorApi, type ProductoE2E } from './ventas';

/** PNG de 1 × 1, como en ventas-fotos.spec.ts. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);


type Respuesta = { reply: string; imagenes: Array<{ productoId: string; nombre: string; varianteId?: string }> };

async function decir(request: APIRequestContext, mensaje: string): Promise<Respuesta> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message: mensaje } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Respuesta;
}

async function subirFoto(request: APIRequestContext, ruta: string): Promise<void> {
  const res = await request.put(`${API_URL}${ruta}`, {
    multipart: { imagen: { name: 'foto.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

type PedidoE2E = {
  id: string;
  tipo: string;
  estado: string;
  totalCentavos: number | null;
  solicitud: { variante: { nombre: string; cantidad: number } | null; cambios: string | null } | null;
};

/** Los pedidos a medida de la cuenta (del banco de pruebas: hay que pedirlos con incluirPrueba). */
async function pedidosAMedida(request: APIRequestContext): Promise<PedidoE2E[]> {
  const res = await request.get(`${API_URL}/ventas?incluirPrueba=true`);
  const { ventas } = (await res.json()) as { ventas: PedidoE2E[] };
  return ventas.filter((venta) => venta.tipo === 'a_medida');
}

test.describe('versiones con precio fijo de un producto a medida', () => {
  test('el dueño carga las versiones con su foto y la tarjeta las muestra', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Cargar mi primer producto' }).click();
    await page.getByRole('link', { name: /^A medida/ }).click();
    const dialogo = page.getByRole('form', { name: 'Nuevo producto a medida' });
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Mesa ratona');

    const versiones = dialogo.getByRole('region', { name: 'Versiones con precio fijo' });
    await versiones.getByRole('button', { name: '+ Agregar una versión' }).click();
    // Una versión a medio cargar se avisa en el pie.
    await expect(dialogo.getByText(/^Falta: el nombre de la versión, el precio de la versión$/)).toBeVisible();
    await versiones.getByLabel('Versión 1', { exact: true }).fill('Roble 1,20 m');
    await versiones.getByLabel('Precio de la versión 1').fill('180.000');
    await versiones.getByLabel('Elegir foto de la versión 1').setInputFiles({ name: 'roble.png', mimeType: 'image/png', buffer: PNG });
    await expect(versiones.getByRole('img', { name: 'Foto de la versión 1' })).toBeVisible();
    await versiones.getByRole('button', { name: '+ Agregar una versión' }).click();
    await versiones.getByLabel('Versión 2', { exact: true }).fill('Pino 1,00 m');
    await versiones.getByLabel('Precio de la versión 2').fill('120.000');

    // La vista previa las ofrece con su precio.
    await expect(dialogo.getByText('Quiero la de roble 1,20 m').first()).toBeVisible();

    await dialogo.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(dialogo).toBeHidden();

    const tarjeta = page.getByRole('list', { name: 'Productos' }).getByRole('listitem').filter({ hasText: 'Mesa ratona' });
    const lista = tarjeta.getByRole('list', { name: 'Versiones con precio fijo de Mesa ratona' });
    await expect(lista).toContainText('Roble 1,20 m');
    await expect(lista).toContainText('$ 180.000');
    await expect(lista).toContainText('Pino 1,00 m');
    await expect(lista.getByRole('img', { name: 'Foto de Roble 1,20 m' })).toBeVisible();

    const listado = await context.request.get(`${API_URL}/productos`);
    const [guardado] = ((await listado.json()) as { productos: ProductoE2E[] }).productos;
    const conFoto = await productoPorApi(context.request, guardado.id);
    expect(conFoto.variantes.map((v) => [v.nombre, v.precioCentavos, v.stock])).toEqual([
      ['Roble 1,20 m', 18_000_000, null],
      ['Pino 1,00 m', 12_000_000, null],
    ]);
    expect((conFoto.variantes[0] as unknown as { imagenActualizada: string | null }).imagenActualizada).toBeTruthy();
  });

  test('el asistente manda las fotos solo, cobra una versión tal cual y deja para cotizar una con cambios', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const res = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'MESA',
        nombre: 'Mesa ratona',
        descripcion: 'Mesa baja de madera maciza.',
        solicitud: { preguntas: [] },
        materiales: [],
        variantes: [
          { nombre: 'Roble 1,20 m', precioCentavos: 18_000_000 },
          { nombre: 'Pino 1,00 m', precioCentavos: 12_000_000 },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const mesa = (await res.json()) as ProductoE2E;
    const roble = mesa.variantes.find((v) => v.nombre === 'Roble 1,20 m')!;
    await subirFoto(context.request, `/productos/${mesa.id}/imagen`);
    await subirFoto(context.request, `/productos/${mesa.id}/variantes/${roble.id}/imagen`);

    // Al mostrarla, la foto del producto sale sola, antes del texto con las versiones.
    const ofrecida = await decir(context.request, 'mesa ratona');
    expect(ofrecida.imagenes).toEqual([{ productoId: mesa.id, nombre: 'Mesa ratona' }]);
    expect(ofrecida.reply).toContain('Roble 1,20 m a $ 180.000');
    expect(ofrecida.reply).toContain('Pino 1,00 m a $ 120.000');

    // La foto propia de una versión.
    const deRoble = await decir(context.request, 'mostrame la foto de la roble');
    expect(deRoble.imagenes).toEqual([{ productoId: mesa.id, nombre: 'Mesa ratona · Roble 1,20 m', varianteId: roble.id }]);

    // Tal cual: el pedido sale con el precio de la versión y el cobro (sin Mercado Pago, a coordinar).
    const tal = await decir(context.request, 'quiero 2 de la roble, soy Ana');
    expect(tal.reply).toContain('Pedido anotado');
    expect(tal.reply).toContain('$ 360.000');
    expect((await pedidosAMedida(context.request))[0]).toMatchObject({
      estado: 'pendiente_pago',
      totalCentavos: 36_000_000,
      solicitud: { variante: { nombre: 'Roble 1,20 m', cantidad: 2 }, cambios: null },
    });

    // Con cambios: queda para cotizar, con la versión de base y lo que cambia.
    const conCambios = await decir(context.request, 'quiero la pino pero de 140 cm; soy Ana');
    expect(conCambios.reply).toContain('Solicitud anotada');
    const aCotizar = (await pedidosAMedida(context.request)).find((pedido) => pedido.estado === 'a_cotizar');
    expect(aCotizar).toMatchObject({ totalCentavos: null, solicitud: { variante: { nombre: 'Pino 1,00 m' }, cambios: 'de 140 cm' } });

    page.on('dialog', (dialogo) => void dialogo.accept());
    await page.goto(`/ventas?venta=${aCotizar!.id}`);
    const detalle = page.getByRole('dialog');
    const loQuePidio = detalle.getByRole('region', { name: 'Lo que pidió' });
    await expect(loQuePidio.getByText('Sobre la versión')).toBeVisible();
    await expect(loQuePidio.getByText('Cambios que pidió')).toBeVisible();
    await expect(loQuePidio.getByText('de 140 cm', { exact: true })).toBeVisible();
  });

  test('si el negocio hace envíos, una versión tal cual no sale sin los datos y quedan en el pedido', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, {
      haceEnvios: true,
      datosCliente: [{ tipo: 'codigoPostal', obligatorio: true }],
    });
    const res = await context.request.post(`${API_URL}/productos`, {
      data: {
        codigo: 'SILLON',
        nombre: 'Sillón Retro',
        descripcion: 'Sillón de estilo retro.',
        solicitud: { preguntas: [] },
        materiales: [],
        variantes: [{ nombre: 'Tres cuerpos 190 cm', precioCentavos: 1_900_000 }],
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    await decir(context.request, 'sillón retro');
    // Sin el código postal (obligatorio) no hay pedido.
    const sinDatos = await decir(context.request, 'quiero la tres cuerpos 190 cm, soy Ana');
    expect(sinDatos.reply).toContain('faltan "Código postal"');
    expect(await pedidosAMedida(context.request)).toHaveLength(0);

    const conDatos = await decir(context.request, 'quiero la tres cuerpos 190 cm, soy Ana; Código postal: 1414');
    expect(conDatos.reply).toContain('Pedido anotado');
    const [pedido] = await pedidosAMedida(context.request);

    page.on('dialog', (dialogo) => void dialogo.accept());
    await page.goto(`/ventas?venta=${pedido.id}`);
    const detalle = page.getByRole('dialog');
    await expect(detalle.getByText('Con envío', { exact: true })).toBeVisible();
    // exact: el detalle a medida también muestra la charla, donde el cliente lo escribió.
    await expect(detalle.getByText('1414', { exact: true })).toBeVisible();
  });
});
