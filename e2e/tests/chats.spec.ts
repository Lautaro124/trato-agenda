import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, esperarRuta, expect, loginDev, telefonoUnico, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

type Mensaje = { de: 'cliente' | 'asistente'; texto: string };

/** No hay WhatsApp real en el stack: el chat se siembra como si el cliente le hubiera escrito. */
async function sembrarChat(request: APIRequestContext, nombre: string, mensajes: Mensaje[]): Promise<string> {
  const res = await request.post(`${API_URL}/auth/dev/chat`, { data: { telefono: telefonoUnico(), nombre, mensajes } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** En el celular la lista y el chat se ven de a uno: hay que tocar el chat para abrirlo. */
async function abrirChat(page: Page, nombre: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(nombre) }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
}

test.describe('chats en Inicio (LAU-81)', () => {
  test('ver un chat, tomar el control, filtrar y devolverlo al bot', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    await sembrarChat(context.request, 'Julián Pérez', [
      { de: 'cliente', texto: '¿Hacen barba también?' },
      { de: 'asistente', texto: 'Sí, Julián. ¿Querés reservar?' },
    ]);
    await sembrarChat(context.request, 'Martina López', [
      { de: 'cliente', texto: 'Hola! Quería saber si hacen alisado' },
      { de: 'asistente', texto: '¡Hola Martina! Sí, hacemos alisado.' },
      { de: 'cliente', texto: '¿Tenés lugar el jueves a la tarde?' },
    ]);

    // Los enlaces viejos a /chats llevan a Inicio, donde ahora están los chats.
    await page.goto('/chats');
    await esperarRuta(page, '/inicio');

    await abrirChat(page, 'Martina López');
    const chat = page.getByRole('region', { name: 'Chat con Martina López' });
    await expect(chat.getByText('¿Tenés lugar el jueves a la tarde?')).toBeVisible();
    await expect(chat.getByText('Contesta el bot')).toBeVisible();

    await chat.getByRole('button', { name: 'Tomar el control y escribir' }).click();
    await expect(chat.getByRole('button', { name: 'Devolver al bot' })).toBeVisible();
    await expect(chat.getByText('El bot está en pausa en este chat hasta que lo devuelvas.')).toBeVisible();

    // Sin WhatsApp vinculado el mensaje no sale y lo escrito queda para reintentar.
    const caja = chat.getByLabel('Tu mensaje para Martina López');
    await caja.fill('Sí, a las 17:30');
    await chat.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByText(/No se pudo mandar/)).toBeVisible();
    await expect(caja).toHaveValue('Sí, a las 17:30');

    // El cliente quedó sin respuesta: devolverlo pregunta qué hace el bot.
    await chat.getByRole('button', { name: 'Devolver al bot' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Devolver el chat al bot' });
    await expect(dialogo.getByText('“¿Tenés lugar el jueves a la tarde?”')).toBeVisible();
    await expect(dialogo.getByLabel(/Nota para el bot/)).toBeVisible();
    await dialogo.getByRole('radio', { name: /Ya lo resolví/ }).check();
    await expect(dialogo.getByLabel(/Nota para el bot/)).toBeHidden();
    await dialogo.getByRole('button', { name: 'Devolver al bot' }).click();
    await expect(dialogo).toBeHidden();
    await expect(chat.getByText('Contesta el bot')).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Tomar el control y escribir' })).toBeVisible();
  });

  test('el filtro Bot/Vos y la marca "Te espera"', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    const id = await sembrarChat(context.request, 'Sofía Ramírez', [{ de: 'cliente', texto: 'Te paso el comprobante' }]);
    await sembrarChat(context.request, 'Carlos Díaz', [
      { de: 'cliente', texto: 'Gracias!' },
      { de: 'asistente', texto: '¡De nada, Carlos!' },
    ]);
    const res = await context.request.post(`${API_URL}/chats/${id}/atencion`, { data: { humana: true } });
    expect(res.status(), await res.text()).toBe(200);

    await page.goto('/inicio');
    const lista = page.getByRole('region', { name: 'Lista de chats' });
    await expect(lista.getByRole('button', { name: 'Vos · 1' })).toBeVisible();
    await lista.getByRole('button', { name: 'Vos · 1' }).click();
    await expect(lista.getByRole('button', { name: /Sofía Ramírez/ })).toContainText('Te espera');
    await expect(lista.getByRole('button', { name: /Carlos Díaz/ })).toBeHidden();

    await lista.getByRole('button', { name: 'Bot · 1' }).click();
    await expect(lista.getByRole('button', { name: /Carlos Díaz/ })).toBeVisible();
    await expect(lista.getByRole('button', { name: /Sofía Ramírez/ })).toBeHidden();

    // El indicador de intervenciones es un atajo al mismo filtro.
    const indicadores = page.getByRole('region', { name: 'Indicadores rápidos' });
    await expect(indicadores.getByRole('button', { name: /^2 chats nuevos/ })).toBeVisible();
    await indicadores.getByRole('button', { name: /^1 intervenciones/ }).click();
    await expect(lista.getByRole('button', { name: 'Vos · 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('la API no deja ver ni tocar el chat de otra cuenta', async ({ context, usuarioDev, browser }) => {
    expect(usuarioDev.email).toBeTruthy();
    const id = await sembrarChat(context.request, 'Ana', [{ de: 'cliente', texto: 'hola' }]);

    const otro = await browser.newContext();
    await loginDev(otro.request, emailUnico('otro'));
    expect((await otro.request.get(`${API_URL}/chats/${id}`)).status()).toBe(404);
    expect((await otro.request.post(`${API_URL}/chats/${id}/atencion`, { data: { humana: true } })).status()).toBe(404);
    const ajeno = await otro.request.post(`${API_URL}/chats/${id}/mensajes`, {
      data: { texto: 'hola', clave: crypto.randomUUID() },
    });
    expect(ajeno.status()).toBe(404);
    await otro.close();
  });
});

test.describe('chats en el celular', () => {
  test('@movil la lista y el chat se ven de a uno, y se toma el control desde el chat', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);
    await sembrarChat(context.request, 'Martina López', [{ de: 'cliente', texto: '¿Tenés lugar el jueves?' }]);

    await page.goto('/inicio');
    const lista = page.getByRole('region', { name: 'Lista de chats' });
    await expect(lista).toBeVisible();

    await abrirChat(page, 'Martina López');
    await expect(lista).toBeHidden();
    const chat = page.getByRole('region', { name: 'Chat con Martina López' });
    await chat.getByRole('button', { name: 'Tomar el control y escribir' }).click();
    await expect(chat.getByRole('button', { name: 'Devolver al bot' })).toBeVisible();
    await expect(chat.getByLabel('Tu mensaje para Martina López')).toBeVisible();

    await chat.getByRole('button', { name: 'Volver a los chats' }).click();
    await expect(lista.getByRole('button', { name: /Martina López/ })).toContainText('Te espera');
  });
});

test.describe('estado del trato (ventas)', () => {
  test('trato hecho arma el pedido con precios de la base, después pagado y la etiqueta lo sigue', async ({ page, context, usuarioDev }, info) => {
    test.skip(info.project.name !== 'escritorio', 'El panel de venta de escritorio; en el celular es el mismo, plegado.');
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'MATE-TRATO', nombre: 'Mate imperial', precioCentavos: 1_280_000, stock: 3 });
    await sembrarChat(context.request, 'Tomás Acosta', [{ de: 'cliente', texto: 'Te lo pago el viernes, ¿me lo guardás?' }]);

    await page.goto('/inicio');
    await abrirChat(page, 'Tomás Acosta');
    // Tres columnas: lista, chat y datos de la venta; los datos se pliegan a un riel y vuelven.
    const panel = page.getByRole('complementary', { name: 'Datos de la venta' });
    await expect(page.getByRole('region', { name: 'Lista de chats' })).toBeVisible();
    await panel.getByRole('button', { name: 'Contraer datos de la venta' }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Mostrar datos de la venta' }).click();
    await expect(panel.getByText('Todavía no pidió productos.')).toBeVisible();

    await panel.getByRole('button', { name: 'Trato hecho' }).click();
    const ticket = panel.getByRole('form', { name: 'Registrar trato hecho' });
    await ticket.getByPlaceholder('Agregar otro producto').fill('Mate imperial');
    await ticket.getByRole('button', { name: 'Buscar' }).click();
    await ticket.getByRole('button', { name: /Mate imperial/ }).click();
    await ticket.getByLabel('Cantidad de Mate imperial').fill('2');
    await ticket.getByRole('button', { name: 'Guardar trato hecho' }).click();

    await expect(page.getByText('Listo: el trato quedó hecho y el pedido, pendiente de pago.')).toBeVisible();
    // Con el trato hecho sólo queda el cobro: desaparece Cancelado.
    await expect(panel.getByRole('button', { name: 'Marcar como pagado' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Cancelado' })).toHaveCount(0);
    // El total lo pone la API: 2 × $ 12.800.
    await expect(panel.getByText('$ 25.600')).toBeVisible();
    // Con el panel abierto la lista sigue a la vista y la etiqueta también se ve en el encabezado del chat.
    const chat = page.getByRole('region', { name: 'Chat con Tomás Acosta' });
    await expect(chat).toContainText('Trato hecho');

    await panel.getByRole('button', { name: 'Marcar como pagado' }).click();
    await expect(panel.getByRole('button', { name: 'Pagado' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chat).toContainText('Pagado');
    await expect(page.getByRole('region', { name: 'Indicadores rápidos' }).getByRole('button', { name: /^100 % chat a venta/ })).toBeVisible();

    // Un trato pagado no se cancela desde acá: el botón ya no está.
    await expect(panel.getByRole('button', { name: 'Cancelado' })).toHaveCount(0);
  });

  test('cancelado sin pedido deja la marca y la API no deja tocar el trato de otra cuenta', async ({ page, context, usuarioDev, browser }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const id = await sembrarChat(context.request, 'Carla Méndez', [{ de: 'cliente', texto: '¿Cuánto sale el envío a Rosario?' }]);

    const res = await context.request.post(`${API_URL}/chats/${id}/trato`, { data: { estado: 'cancelado' } });
    expect(res.status(), await res.text()).toBe(200);
    await page.goto('/inicio');
    const lista = page.getByRole('region', { name: 'Lista de chats' });
    await lista.getByRole('button', { name: 'Cancelado · 1' }).click();
    await expect(lista.getByRole('button', { name: /Carla Méndez/ })).toContainText('Cancelado');

    const otro = await browser.newContext();
    await loginDev(otro.request, emailUnico('otro-trato'));
    expect((await otro.request.post(`${API_URL}/chats/${id}/trato`, { data: { estado: 'pagado' } })).status()).toBe(404);
    expect((await otro.request.get(`${API_URL}/chats/${id}/ficha`)).status()).toBe(404);
    await otro.close();
  });
});
