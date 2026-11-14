import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, esperarRuta, expect, loginDev, telefonoUnico, test } from './fixtures';

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

test.describe('chats (LAU-81)', () => {
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

    await page.goto('/inicio');
    await page.getByRole('link', { name: 'Chats' }).click();
    await esperarRuta(page, '/chats');

    await abrirChat(page, 'Martina López');
    const chat = page.getByRole('region', { name: 'Chat con Martina López' });
    await expect(chat.getByText('¿Tenés lugar el jueves a la tarde?')).toBeVisible();
    await expect(chat.getByText('Contesta el bot')).toBeVisible();

    await chat.getByRole('button', { name: 'Tomar el control', exact: true }).click();
    await expect(chat.getByText('Contestás vos')).toBeVisible();
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
    await expect(chat.getByRole('button', { name: 'Tomar el control', exact: true })).toBeVisible();
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

    await page.goto('/chats');
    const lista = page.getByRole('region', { name: 'Lista de chats' });
    await expect(lista.getByRole('button', { name: 'Vos · 1' })).toBeVisible();
    await lista.getByRole('button', { name: 'Vos · 1' }).click();
    await expect(lista.getByRole('button', { name: /Sofía Ramírez/ })).toContainText('Te espera');
    await expect(lista.getByRole('button', { name: /Carlos Díaz/ })).toBeHidden();

    await lista.getByRole('button', { name: 'Bot · 1' }).click();
    await expect(lista.getByRole('button', { name: /Carlos Díaz/ })).toBeVisible();
    await expect(lista.getByRole('button', { name: /Sofía Ramírez/ })).toBeHidden();
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
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('dialog', { name: 'Menú' }).getByRole('link', { name: 'Chats' }).click();
    await esperarRuta(page, '/chats');
    const lista = page.getByRole('region', { name: 'Lista de chats' });
    await expect(lista).toBeVisible();

    await abrirChat(page, 'Martina López');
    await expect(lista).toBeHidden();
    const chat = page.getByRole('region', { name: 'Chat con Martina López' });
    await chat.getByRole('button', { name: 'Tomar el control y escribir' }).click();
    await expect(chat.getByText('Contestás vos')).toBeVisible();
    await expect(chat.getByLabel('Tu mensaje para Martina López')).toBeVisible();

    await chat.getByRole('button', { name: 'Volver a los chats' }).click();
    await expect(lista.getByRole('button', { name: /Martina López/ })).toContainText('Te espera');
  });
});

test.describe('tutorial de chats', () => {
  test('la primera vez explica la lista, Bot o Vos, el botón y el teléfono', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'escritorio', 'En el celular el chat abierto tapa la lista: el recorrido salta pasos.');
    await loginDev(context.request, emailUnico('tutorial-chats'), undefined, { conTutoriales: true });
    await crearAgentePorApi(context.request);
    // Inicio tiene su propio recorrido: se marca visto para entrar directo a Chats.
    await context.request.post(`${API_URL}/auth/tutoriales`, { data: { claves: ['inicio'] } });
    await sembrarChat(context.request, 'Martina López', [{ de: 'cliente', texto: 'Hola!' }]);

    await page.goto('/chats');
    const titulos = ['Tus chats de WhatsApp', 'Bot o Vos', 'Un botón decide quién contesta', 'Contestá desde acá o desde tu teléfono'];
    for (const [i, titulo] of titulos.entries()) {
      const paso = page.getByRole('dialog', { name: titulo });
      await expect(paso).toBeVisible();
      await paso.getByRole('button', { name: i === titulos.length - 1 ? 'Listo' : 'Siguiente' }).click();
    }
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Cómo funciona' }).click();
    await expect(page.getByRole('dialog', { name: 'Tus chats de WhatsApp' })).toBeVisible();
  });
});
