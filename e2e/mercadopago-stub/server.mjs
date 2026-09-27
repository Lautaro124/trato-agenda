// Mercado Pago falso para los E2E de Playwright y para probar en local. Cubre
// lo que usa el asistente de ventas de cada comercio:
//
//   - OAuth con PKCE: GET /authorization redirige al redirect_uri con un code,
//     y POST /oauth/token lo canjea (verificando el code_verifier) o renueva;
//   - POST /checkout/preferences crea el link de pago; GET /checkout/:id es una
//     pantalla con un botón "Pagar" que aprueba el pago y dispara el webhook
//     firmado (x-signature) al notification_url, igual que Mercado Pago;
//   - GET /v1/payments/:id y /v1/payments/search para la conciliación.
//
// Sin dependencias: corre con `node server.mjs` o dentro de node:24-alpine.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

const PUERTO = Number(process.env.PORT ?? 4020);
/** Cómo lo ve el navegador (init_point, pantalla de autorización). */
const URL_PUBLICA = (process.env.URL_PUBLICA ?? `http://localhost:${PUERTO}`).replace(/\/+$/, '');
/** Secreto con el que se firman los webhooks: el MERCADOPAGO_WEBHOOK_SECRET de la API. */
const SECRETO_WEBHOOK = process.env.SECRETO_WEBHOOK ?? 'e2e-webhook-secret';
/**
 * Si la API no es alcanzable por el origen del notification_url (dentro de
 * docker compose es "api", no localhost), se reescribe a este.
 */
const API_INTERNA = process.env.API_INTERNA ?? '';

const codigos = new Map(); // code → { desafio, redirectUri }
const tokens = new Map(); // access_token → { userId }
const preferencias = new Map(); // id → preferencia
const pagos = new Map(); // id → pago
let llamadas = [];
let siguienteUsuario = 777000;
// Como en Mercado Pago, un id de pago no se repite nunca, tampoco entre
// reinicios del stub: la API lo guarda en una columna única (Venta.mpPaymentId).
let siguientePago = Date.now();

function responder(res, status, cuerpo, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (parte) => (datos += parte));
    req.on('end', () => {
      const tipo = req.headers['content-type'] ?? '';
      try {
        if (!datos) return resolve({});
        if (tipo.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(datos)));
        resolve(JSON.parse(datos));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function tokenDe(req) {
  const valor = req.headers.authorization ?? '';
  return valor.startsWith('Bearer ') ? valor.slice(7) : null;
}

function emitirTokens(userId) {
  const acceso = `APP_USR-stub-${randomUUID()}`;
  tokens.set(acceso, { userId });
  return { access_token: acceso, refresh_token: `TG-stub-${randomUUID()}-${userId}`, expires_in: 15552000, user_id: userId, token_type: 'bearer' };
}

async function notificar(pago, preferencia) {
  if (!preferencia.notification_url) return;
  const url = new URL(preferencia.notification_url);
  if (API_INTERNA) {
    const interna = new URL(API_INTERNA);
    url.protocol = interna.protocol;
    url.host = interna.host;
  }
  url.searchParams.set('data.id', String(pago.id));
  url.searchParams.set('type', 'payment');
  const ts = String(Date.now());
  const requestId = randomUUID();
  const v1 = createHmac('sha256', SECRETO_WEBHOOK).update(`id:${String(pago.id).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      body: JSON.stringify({ action: 'payment.created', type: 'payment', data: { id: String(pago.id) }, user_id: pago.collector_id }),
    });
    llamadas.push({ tipo: 'webhook', url: url.toString(), status: res.status });
  } catch (error) {
    // El detalle va a la consola del stub; /__llamadas sólo expone que falló
    // (nada de mensajes ni stack traces en una respuesta HTTP).
    console.error('No se pudo entregar el webhook:', error);
    llamadas.push({ tipo: 'webhook', url: url.toString(), error: 'no se pudo entregar' });
  }
}

function pantallaDePago(preferencia) {
  const total = preferencia.items.reduce((suma, item) => suma + item.unit_price * item.quantity, 0);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mercado Pago (falso)</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto">
<h1>Mercado Pago de prueba</h1>
<ul>${preferencia.items.map((item) => `<li>${item.quantity} × ${item.title}: $${item.unit_price}</li>`).join('')}</ul>
<p>Total: $${total}</p>
<form method="post" action="/checkout/${preferencia.id}/pagar"><button type="submit">Pagar</button></form>
</body></html>`;
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`);
  const ruta = url.pathname;

  if (req.method === 'GET' && ruta === '/health') return responder(res, 200, { status: 'ok' });

  if (ruta === '/__llamadas') {
    if (req.method === 'DELETE') {
      llamadas = [];
      return responder(res, 204, '');
    }
    return responder(res, 200, llamadas);
  }

  // --- OAuth ---
  if (req.method === 'GET' && ruta === '/authorization') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const desafio = url.searchParams.get('code_challenge');
    if (!redirectUri || !state || !desafio) return responder(res, 400, { error: 'faltan parámetros' });
    const code = `TG-code-${randomUUID()}`;
    codigos.set(code, { desafio, redirectUri });
    llamadas.push({ tipo: 'autorizacion', clientId: url.searchParams.get('client_id') });
    const destino = new URL(redirectUri);
    destino.searchParams.set('code', code);
    destino.searchParams.set('state', state);
    res.writeHead(302, { Location: destino.toString() });
    return res.end();
  }

  if (req.method === 'POST' && ruta === '/oauth/token') {
    const cuerpo = await leerCuerpo(req);
    llamadas.push({ tipo: 'oauth', grant: cuerpo.grant_type });
    if (!cuerpo.client_id || !cuerpo.client_secret) return responder(res, 401, { error: 'invalid_client' });
    if (cuerpo.grant_type === 'authorization_code') {
      const pendiente = codigos.get(cuerpo.code);
      codigos.delete(cuerpo.code);
      const desafio = cuerpo.code_verifier ? createHash('sha256').update(cuerpo.code_verifier).digest('base64url') : null;
      if (!pendiente || pendiente.desafio !== desafio || pendiente.redirectUri !== cuerpo.redirect_uri) {
        return responder(res, 400, { error: 'invalid_grant' });
      }
      return responder(res, 200, emitirTokens(siguienteUsuario++));
    }
    if (cuerpo.grant_type === 'refresh_token') {
      const userId = Number(String(cuerpo.refresh_token ?? '').split('-').at(-1));
      if (!userId) return responder(res, 400, { error: 'invalid_grant' });
      return responder(res, 200, emitirTokens(userId));
    }
    return responder(res, 400, { error: 'unsupported_grant_type' });
  }

  // --- Links de pago ---
  if (req.method === 'POST' && ruta === '/checkout/preferences') {
    const token = tokens.get(tokenDe(req));
    if (!token) return responder(res, 401, { message: 'invalid access token' });
    const cuerpo = await leerCuerpo(req);
    const id = `pref-${randomUUID()}`;
    preferencias.set(id, { id, collectorId: token.userId, ...cuerpo });
    llamadas.push({ tipo: 'preferencia', id, external_reference: cuerpo.external_reference, items: cuerpo.items });
    return responder(res, 201, { id, init_point: `${URL_PUBLICA}/checkout/${id}`, collector_id: token.userId });
  }

  const checkout = ruta.match(/^\/checkout\/(pref-[\w-]+)(\/pagar)?$/);
  if (checkout) {
    const preferencia = preferencias.get(checkout[1]);
    if (!preferencia) return responder(res, 404, { message: 'preference not found' });
    if (req.method === 'GET' && !checkout[2]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pantallaDePago(preferencia));
    }
    if (req.method === 'POST' && checkout[2]) {
      const pago = {
        id: siguientePago++,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: preferencia.external_reference,
        transaction_amount: preferencia.items.reduce((suma, item) => suma + item.unit_price * item.quantity, 0),
        currency_id: preferencia.items[0]?.currency_id ?? 'ARS',
        collector_id: preferencia.collectorId,
        date_approved: new Date().toISOString(),
      };
      pagos.set(String(pago.id), pago);
      await notificar(pago, preferencia);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html lang="es"><body><h1>¡Pago aprobado!</h1></body></html>');
    }
  }

  // --- Pagos ---
  if (req.method === 'GET' && ruta === '/v1/payments/search') {
    const token = tokens.get(tokenDe(req));
    if (!token) return responder(res, 401, { message: 'invalid access token' });
    const referencia = url.searchParams.get('external_reference');
    const resultados = [...pagos.values()].filter(
      (pago) => pago.collector_id === token.userId && pago.external_reference === referencia,
    );
    return responder(res, 200, { paging: { total: resultados.length }, results: resultados });
  }

  const pago = ruta.match(/^\/v1\/payments\/(\d+)$/);
  if (req.method === 'GET' && pago) {
    const token = tokens.get(tokenDe(req));
    if (!token) return responder(res, 401, { message: 'invalid access token' });
    const encontrado = pagos.get(pago[1]);
    // Un pago de otro comercio no existe para este token, igual que en Mercado Pago.
    if (!encontrado || encontrado.collector_id !== token.userId) return responder(res, 404, { message: 'Payment not found' });
    return responder(res, 200, encontrado);
  }

  return responder(res, 404, { message: `Ruta desconocida: ${req.method} ${ruta}` });
});

servidor.listen(PUERTO, '0.0.0.0', () => console.log(`Mercado Pago falso escuchando en :${PUERTO}`));

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
