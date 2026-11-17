import { createHmac, randomInt } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { API_URL, META_APP_SECRET, META_STUB_URL } from '../entorno';
import { crearAgentePorApi, emailUnico, expect, loginDev, telefonoUnico, test } from './fixtures';

/**
 * WhatsApp Business por la Cloud API, contra la Graph API falsa (e2e/meta-stub).
 * El popup de Embedded Signup no se automatiza: el test arma lo que vuelve de
 * él (el `code` que el stub sabe canjear) y lo manda a la API como la web.
 */
function signup(telefono: string, { coexistencia = false } = {}) {
  const wabaId = String(randomInt(1e9, 2e9));
  const phoneNumberId = String(randomInt(1e9, 2e9));
  return { code: `e2e:${wabaId}:${phoneNumberId}:${telefono}`, wabaId, phoneNumberId, coexistencia };
}

type Llamada = { tipo: string; telefono: string; para?: string; texto?: string | null; sync?: string };

async function llamadasDeMeta(request: APIRequestContext, telefono: string): Promise<Llamada[]> {
  const res = await request.get(`${META_STUB_URL}/__llamadas?telefono=${telefono}`);
  return (await res.json()) as Llamada[];
}

/** Un webhook de Meta firmado como lo firma Meta: HMAC del cuerpo crudo. */
async function webhook(request: APIRequestContext, cuerpo: object, secreto = META_APP_SECRET) {
  const crudo = Buffer.from(JSON.stringify(cuerpo));
  const firma = `sha256=${createHmac('sha256', secreto).update(crudo).digest('hex')}`;
  return request.post(`${API_URL}/whatsapp/meta/webhook`, {
    data: crudo,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma },
  });
}

function mensajeDeCliente(phoneNumberId: string, cliente: string, texto: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5491100000000', phone_number_id: phoneNumberId },
              messages: [
                { from: cliente, id: `wamid.e2e${randomInt(1e9)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } },
              ],
            },
          },
        ],
      },
    ],
  };
}

test.describe('WhatsApp Business por la API oficial', () => {
  test('crear la cuenta con WhatsApp Business deja la sesión y el número conectado', async ({ context, page }) => {
    const telefono = telefonoUnico();
    const res = await context.request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(telefono) });
    expect(res.status(), await res.text()).toBe(200);

    const me = await context.request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { phoneNumber: string }).phoneNumber).toBe(telefono);

    const estado = await context.request.get(`${API_URL}/whatsapp/status`);
    expect(await estado.json()).toMatchObject({ linked: true, phoneNumber: telefono, canal: 'meta', metaDisponible: true });

    // Número nuevo (sin coexistencia): se suscribe la app y se registra el número.
    const llamadas = await llamadasDeMeta(context.request, telefono);
    expect(llamadas.map((l) => l.tipo)).toEqual(expect.arrayContaining(['suscribir', 'register']));

    // Con la API oficial no se abre además una sesión por QR.
    expect((await context.request.post(`${API_URL}/whatsapp/link/start`)).status()).toBe(409);

    await page.goto('/vincular');
    await expect(page.getByRole('heading', { name: 'WhatsApp Business conectado' })).toBeVisible();
    await expect(page.getByText(`+${telefono}`)).toBeVisible();
  });

  test('volver con el mismo número y la misma WABA entra a la misma cuenta (y sirve para recuperar el acceso)', async ({ browser }) => {
    const telefono = telefonoUnico();
    const datos = signup(telefono);
    const primera = await browser.newContext();
    const segunda = await browser.newContext();
    try {
      expect((await primera.request.post(`${API_URL}/auth/whatsapp/meta`, { data: datos })).status()).toBe(200);
      const idPrimera = ((await (await primera.request.get(`${API_URL}/auth/me`)).json()) as { id: string }).id;

      // En coexistencia no se registra el número: se pide la sincronización.
      const res = await segunda.request.post(`${API_URL}/auth/whatsapp/meta`, { data: { ...datos, coexistencia: true } });
      expect(res.status(), await res.text()).toBe(200);
      const idSegunda = ((await (await segunda.request.get(`${API_URL}/auth/me`)).json()) as { id: string }).id;
      expect(idSegunda).toBe(idPrimera);
      const syncs = (await llamadasDeMeta(segunda.request, telefono)).filter((l) => l.tipo === 'smb_app_data').map((l) => l.sync);
      expect(syncs).toEqual(expect.arrayContaining(['smb_app_state_sync', 'history']));
    } finally {
      await primera.close();
      await segunda.close();
    }
  });

  test('una cuenta que no se creó con esa WABA no se abre con WhatsApp Business', async ({ browser }) => {
    const telefono = telefonoUnico();
    const duena = await browser.newContext();
    const otra = await browser.newContext();
    try {
      // La cuenta existe (creada con otra WABA, o por QR, o con Google y ese número).
      expect((await duena.request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(telefono) })).status()).toBe(200);
      // Quien administra otra WABA con el mismo número no entra.
      const res = await otra.request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(telefono) });
      expect(res.status()).toBe(409);
      expect(((await res.json()) as { motivo: string }).motivo).toBe('cuenta_existente');
      expect((await otra.request.get(`${API_URL}/auth/me`)).status()).toBe(401);
    } finally {
      await duena.close();
      await otra.close();
    }
  });

  test('un número que Meta no da por verificado no crea cuenta', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(`5491155${String(randomInt(1e2)).padStart(2, '0')}0000`) });
    expect(res.status()).toBe(400);
  });

  test('un código que Meta no reconoce no crea nada', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/whatsapp/meta`, {
      data: { code: 'inventado', wabaId: '123', phoneNumberId: '456', coexistencia: false },
    });
    expect(res.status()).toBe(502);
    expect(res.headers()['set-cookie']).toBeUndefined();
  });

  test('conectar el número de otra cuenta da 409', async ({ browser, context }) => {
    const telefono = telefonoUnico();
    const otra = await browser.newContext();
    try {
      expect((await otra.request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(telefono) })).status()).toBe(200);
    } finally {
      await otra.close();
    }
    await loginDev(context.request, emailUnico());
    const res = await context.request.post(`${API_URL}/whatsapp/meta/conectar`, { data: signup(telefono) });
    expect(res.status()).toBe(409);
  });

  test('desde /vincular se puede desconectar', async ({ context, page }) => {
    const telefono = telefonoUnico();
    expect((await context.request.post(`${API_URL}/auth/whatsapp/meta`, { data: signup(telefono) })).status()).toBe(200);

    await page.goto('/vincular');
    await page.getByRole('button', { name: 'Desconectar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Desconectar' }).click();

    await expect(page.getByRole('heading', { name: 'Conectá tu WhatsApp Business' })).toBeVisible();
    expect((await llamadasDeMeta(context.request, telefono)).some((l) => l.tipo === 'desuscribir')).toBe(true);
  });
});

test.describe('webhook de la Cloud API', () => {
  test('el alta del webhook exige el token de verificación', async ({ request }) => {
    const ok = await request.get(
      `${API_URL}/whatsapp/meta/webhook?hub.mode=subscribe&hub.verify_token=e2e-meta-verify-token-0123456789&hub.challenge=12345`,
    );
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe('12345');

    const mal = await request.get(`${API_URL}/whatsapp/meta/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345`);
    expect(mal.status()).toBe(404);
  });

  test('un webhook sin la firma de Meta se ignora', async ({ request }) => {
    const res = await webhook(request, mensajeDeCliente('1', '5491122334455', 'hola'), 'secreto-equivocado');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ recibido: false });
  });

  test('el asistente contesta por la Cloud API el mensaje de un cliente', async ({ context }) => {
    const telefono = telefonoUnico();
    await loginDev(context.request, emailUnico());
    await crearAgentePorApi(context.request);
    const datos = signup(telefono);
    expect((await context.request.post(`${API_URL}/whatsapp/meta/conectar`, { data: datos })).status()).toBe(204);

    const cliente = telefonoUnico();
    const res = await webhook(context.request, mensajeDeCliente(datos.phoneNumberId, cliente, 'Hola, ¿qué turnos tenés?'));
    expect(await res.json()).toEqual({ recibido: true });

    await expect
      .poll(async () => (await llamadasDeMeta(context.request, telefono)).filter((l) => l.tipo === 'mensaje' && l.para === cliente).length, {
        timeout: 45_000,
      })
      .toBeGreaterThan(0);
  });
});
