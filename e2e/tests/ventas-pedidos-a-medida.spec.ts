/**
 * Pedidos a medida de punta a punta (LAU-24/26/27): la solicitud queda como
 * pedido, el dueño (o la receta) la cotiza, el cliente acepta y se cobra; y
 * un pedido en atención humana calla al asistente hasta que se lo devuelven.
 * Todo desde el banco de pruebas del Home (`/conversation/test`).
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi } from './ventas';


const PREGUNTAS = [
  { texto: 'Ancho (cm)', opciones: [], textoLibre: true, obligatoria: true, numero: { variable: 'ancho', unidad: 'cm', min: 30, max: 300 } },
  { texto: 'Alto (cm)', opciones: [], textoLibre: true, obligatoria: true, numero: { variable: 'alto', unidad: 'cm', min: 30, max: 300 } },
];

async function crearPlacard(request: APIRequestContext, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post(`${API_URL}/productos`, {
    data: { codigo: 'PLACARD', nombre: 'Placard', descripcion: 'A medida', solicitud: { preguntas: PREGUNTAS }, materiales: [], ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function decir(request: APIRequestContext, mensaje: string): Promise<string> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message: mensaje } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { reply: string }).reply;
}

/** El único pedido a medida de la cuenta (del banco de pruebas: hay que pedirlo con incluirPrueba). */
async function pedidoAMedida(request: APIRequestContext): Promise<{ id: string; estado: string; totalCentavos: number | null }> {
  const res = await request.get(`${API_URL}/ventas?incluirPrueba=true`);
  const { ventas } = (await res.json()) as { ventas: Array<{ id: string; tipo: string; estado: string; totalCentavos: number | null }> };
  const pedido = ventas.find((venta) => venta.tipo === 'a_medida');
  expect(pedido).toBeTruthy();
  return pedido!;
}

/** El detalle del pedido abierto desde el link de un aviso. */
async function abrirPedido(page: Page, id: string) {
  page.on('dialog', (dialogo) => void dialogo.accept());
  await page.goto(`/ventas?venta=${id}`);
  const detalle = page.getByRole('dialog');
  await expect(detalle.getByText('Lo que pidió')).toBeVisible();
  return detalle;
}

test.describe('pedidos a medida (LAU-27)', () => {
  test('la solicitud queda como pedido: el dueño la cotiza, el cliente acepta y se cobra', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearPlacard(context.request);

    expect(await decir(context.request, 'placard')).toContain('Hacemos Placard a medida');
    // Sin un número válido para la pregunta necesaria, no se anota nada.
    expect(await decir(context.request, 'quiero uno, soy Ana; Ancho (cm): mucho; Alto (cm): 200')).toContain('no está completa');
    const anotada = await decir(context.request, 'quiero uno, soy Ana; Ancho (cm): 120; Alto (cm): 240');
    expect(anotada).toContain('Solicitud anotada');

    const pedido = await pedidoAMedida(context.request);
    expect(pedido).toMatchObject({ estado: 'a_cotizar', totalCentavos: null });

    // El dueño arma el presupuesto a mano y se lo manda.
    const detalle = await abrirPedido(page, pedido.id);
    await expect(detalle.getByRole('region', { name: 'Lo que pidió' }).getByText('Ancho (cm)', { exact: true })).toBeVisible();
    await detalle.getByRole('button', { name: 'Armar presupuesto' }).click();
    const renglon = detalle.getByRole('group', { name: 'Renglón 1' });
    await renglon.getByLabel('Qué es').fill('Placard de melamina 120 × 240');
    await renglon.getByLabel('Precio por unidad').fill('185.000');
    await detalle.getByRole('button', { name: 'Mandar al cliente' }).click();
    await expect(detalle.getByText('Vigente')).toBeVisible();
    await expect(detalle.getByText('Cotizado').first()).toBeVisible();

    // El cliente dice que sí: el asistente genera el cobro (sin Mercado Pago, a coordinar).
    const aceptado = await decir(context.request, 'dale, avancemos');
    expect(aceptado).toContain('Presupuesto aceptado');
    expect(aceptado).toContain('$ 185.000');
    expect(await pedidoAMedida(context.request)).toMatchObject({ estado: 'pendiente_pago', totalCentavos: 18_500_000 });

    await page.reload();
    await page.getByRole('dialog').getByRole('button', { name: 'Marcar pagada' }).click();
    await expect(page.getByRole('dialog').getByText('Pagada').first()).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Historial del pedido' })).toContainText('Pasó a pagada');
  });

  test('con receta el asistente cotiza solo, con la cuenta del sistema', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const insumo = await context.request.post(`${API_URL}/costos/insumos`, {
      data: { tipo: 'material', nombre: 'Melamina blanca 18 mm', unidad: 'm2', costoCentavos: 2_000_000 },
    });
    expect(insumo.status(), await insumo.text()).toBe(201);
    const { id: insumoId } = (await insumo.json()) as { id: string };
    await crearPlacard(context.request, {
      receta: { renglones: [{ insumoId, cantidad: 'ancho × alto ÷ 10000' }], extras: [{ nombre: 'Instalación', modo: 'fijo', valor: 3_000_000 }] },
      politicaCotizacion: 'automatica',
    });

    await decir(context.request, 'placard');
    // 100 × 200 / 10000 = 2 m² × $ 20.000 + $ 30.000 de instalación.
    const cotizado = await decir(context.request, 'quiero uno, soy Ana; Ancho (cm): 100; Alto (cm): 200');
    expect(cotizado).toContain('*Total: $ 70.000*');
    expect(cotizado).toContain('es estimativo');
    // El costo de los materiales no le llega al cliente.
    expect(cotizado).not.toContain('Melamina');
    expect(await pedidoAMedida(context.request)).toMatchObject({ estado: 'cotizado', totalCentavos: 7_000_000 });
  });

  test('en atención humana el asistente se calla hasta que el dueño se lo devuelve', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearPlacard(context.request);

    expect(await decir(context.request, 'quiero hablar con una persona')).toContain('pasó a una persona del equipo');
    expect(await decir(context.request, '¿hola?')).toContain('atención humana');

    const pedido = await pedidoAMedida(context.request);
    expect(pedido.estado).toBe('solicitado');
    const detalle = await abrirPedido(page, pedido.id);
    await expect(detalle.getByText('Lo atendés vos').first()).toBeVisible();
    await expect(detalle.getByText(/^Motivo: Quiere hablar con una persona/)).toBeVisible();
    await detalle.getByLabel('Qué le dejás dicho al asistente (opcional)').fill('Ya le pasé las medidas por teléfono');
    await detalle.getByRole('button', { name: 'Devolver al asistente' }).click();
    await expect(detalle.getByRole('button', { name: 'Atender yo' })).toBeVisible();

    expect(await decir(context.request, 'hola de nuevo')).toContain('¡Hola!');
  });

  test('materiales y costos se cargan en /costos y la receta se prueba en el editor', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearPlacard(context.request);

    await page.goto('/costos');
    const materiales = page.getByRole('form', { name: 'Agregar a materiales' });
    await materiales.getByLabel('Nuevo').fill('Melamina blanca 18 mm');
    await materiales.getByLabel('Te cuesta ($)').fill('20.000');
    await materiales.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.getByRole('list', { name: 'Materiales' }).getByRole('group', { name: 'Melamina blanca 18 mm' })).toBeVisible();

    const config = page.getByRole('form', { name: 'Cómo cotiza tu asistente' });
    await config.getByRole('button', { name: '+ Agregar extra' }).click();
    await config.getByLabel('Nombre del extra').fill('Ganancia');
    await config.getByLabel('Porcentaje').fill('50');
    await config.getByRole('button', { name: 'Guardar' }).click();
    await expect(config.getByText('Guardado.')).toBeVisible();

    // En el editor del producto: la receta con el material y la vista previa con la cuenta real.
    await page.goto('/productos');
    await page.getByRole('button', { name: /Editar/ }).first().click();
    const editor = page.getByRole('form', { name: 'Editar producto a medida' });
    const seccion = editor.getByRole('region', { name: 'Cómo se cotiza' });
    await seccion.getByText('Tu asistente cotiza y lo manda').click();
    await seccion.getByRole('button', { name: '+ Agregar a la receta' }).click();
    const renglon = seccion.getByRole('group', { name: 'Renglón 1 de la receta' });
    await renglon.getByLabel('Qué usa').selectOption({ label: 'Melamina blanca 18 mm ($ 20.000 por m²)' });
    await renglon.getByLabel(/^Cuánto/).fill('');
    const barra = renglon.getByRole('toolbar');
    await barra.getByRole('button', { name: 'ancho' }).click();
    await barra.getByRole('button', { name: 'Insertar ×' }).click();
    await barra.getByRole('button', { name: 'alto' }).click();
    await barra.getByRole('button', { name: 'Insertar ÷' }).click();
    await renglon.getByLabel(/^Cuánto/).pressSequentially('10000');
    await expect(renglon.getByLabel(/^Cuánto/)).toHaveValue('ancho × alto ÷ 10000');

    const prueba = seccion.getByRole('region', { name: 'Probá la cotización' });
    await prueba.getByLabel('Ancho (cm)').fill('100');
    await prueba.getByLabel('Alto (cm)').fill('200');
    // 2 m² × $ 20.000 = $ 40.000, más 50 % de ganancia.
    await expect(prueba.getByRole('status')).toContainText('$ 60.000');

    await editor.getByRole('button', { name: 'Guardar producto' }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByText('Cotiza tu asistente')).toBeVisible();
  });
});
