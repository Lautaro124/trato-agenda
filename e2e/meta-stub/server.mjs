// Graph API de Meta falsa para los E2E de Playwright: lo que usa la conexión
// de WhatsApp Business por la Cloud API (Embedded Signup + mensajes).
//
// El popup de Embedded Signup no se puede automatizar, así que el `code` lo
// arma el test: "e2e:<wabaId>:<phoneNumberId>:<telefono>". El canje devuelve
// un token que codifica eso mismo, y /phone_numbers sólo muestra el número a
// ese token y para esa WABA (como Meta, que no deja ver WABAs ajenas).
//
//   - POST /v26.0/oauth/access_token          canje del code
//   - GET  /v26.0/:waba/phone_numbers         números de la WABA
//   - POST|DELETE /v26.0/:waba/subscribed_apps
//   - POST /v26.0/:phone/register | /smb_app_data | /messages | /media
//   - GET  /v26.0/:media  y  GET /descargas/:media  (audio e imágenes de clientes)
//   - GET  /__llamadas?telefono=… lo que la API mandó (para los asserts)
//
// Sin dependencias: corre con `node server.mjs`.
import http from 'node:http';

const PUERTO = Number(process.env.PORT ?? 4040);
/** Cómo ve la API a este stub (las URLs de descarga tienen que ser de su mismo origen). */
const URL_INTERNA = (process.env.URL_INTERNA ?? `http://localhost:${PUERTO}`).replace(/\/+$/, '');
const VERSION = 'v26.0';

let llamadas = [];

function responder(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    const partes = [];
    req.on('data', (parte) => partes.push(parte));
    req.on('end', () => {
      const datos = Buffer.concat(partes).toString('utf8');
      const tipo = req.headers['content-type'] ?? '';
      if (!datos) return resolve({});
      if (tipo.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(datos)));
      if (tipo.includes('multipart/form-data')) return resolve({ multipart: true });
      try {
        resolve(JSON.parse(datos));
      } catch {
        resolve({});
      }
    });
  });
}

/** "e2e:<waba>:<phone>:<telefono>" → partes, o null. */
function deCodigo(codigo) {
  const partes = String(codigo ?? '').split(':');
  if (partes.length !== 4 || partes[0] !== 'e2e') return null;
  const [, wabaId, phoneNumberId, telefono] = partes;
  return { wabaId, phoneNumberId, telefono };
}

function deToken(req) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer tok-')) return null;
  return deCodigo(Buffer.from(auth.slice('Bearer tok-'.length), 'base64url').toString('utf8'));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  const ruta = url.pathname;

  if (req.method === 'GET' && ruta === '/health') return responder(res, 200, { status: 'ok' });
  if (req.method === 'GET' && ruta === '/__llamadas') {
    const telefono = url.searchParams.get('telefono');
    return responder(res, 200, telefono ? llamadas.filter((l) => l.telefono === telefono) : llamadas);
  }
  if (req.method === 'GET' && ruta.startsWith('/descargas/')) {
    res.writeHead(200, { 'Content-Type': 'audio/ogg' });
    return res.end(Buffer.from('OggS-audio-falso'));
  }

  if (!ruta.startsWith(`/${VERSION}/`)) return responder(res, 404, { error: { message: 'versión desconocida', code: 100 } });
  const partes = ruta.slice(VERSION.length + 2).split('/');
  const cuerpo = await leerCuerpo(req);

  if (req.method === 'POST' && partes.join('/') === 'oauth/access_token') {
    const datos = deCodigo(cuerpo.code);
    if (!datos || cuerpo.client_secret !== 'e2e-meta-secret') {
      return responder(res, 400, { error: { message: 'código inválido', code: 100 } });
    }
    return responder(res, 200, { access_token: `tok-${Buffer.from(cuerpo.code).toString('base64url')}`, token_type: 'bearer' });
  }

  const token = deToken(req);
  if (!token) return responder(res, 401, { error: { message: 'token inválido', code: 190 } });
  const [id, recurso] = partes;
  const registrar = (tipo, extra = {}) => llamadas.push({ tipo, telefono: token.telefono, ...extra });

  if (req.method === 'GET' && recurso === 'phone_numbers') {
    if (id !== token.wabaId) return responder(res, 403, { error: { message: 'sin acceso a la WABA', code: 200 } });
    // Un teléfono que termina en 0000 imita un número agregado sin verificar su código.
    const verificado = !token.telefono.endsWith('0000');
    return responder(res, 200, {
      data: [
        {
          id: token.phoneNumberId,
          display_phone_number: `+${token.telefono}`,
          code_verification_status: verificado ? 'VERIFIED' : 'NOT_VERIFIED',
        },
      ],
    });
  }
  if (recurso === 'subscribed_apps') {
    registrar(req.method === 'DELETE' ? 'desuscribir' : 'suscribir');
    return responder(res, 200, { success: true });
  }
  if (req.method === 'POST' && (recurso === 'register' || recurso === 'smb_app_data')) {
    registrar(recurso, recurso === 'smb_app_data' ? { sync: cuerpo.sync_type } : {});
    return responder(res, 200, { success: true });
  }
  if (req.method === 'POST' && recurso === 'media') {
    registrar('media');
    return responder(res, 200, { id: `media-${Date.now()}` });
  }
  if (req.method === 'POST' && recurso === 'messages') {
    if (cuerpo.status === 'read') registrar('leido', { mensaje: cuerpo.message_id });
    else registrar('mensaje', { para: cuerpo.to, tipoMensaje: cuerpo.type, texto: cuerpo.text?.body ?? null });
    return responder(res, 200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.stub${Date.now()}` }] });
  }
  if (req.method === 'GET' && !recurso) {
    return responder(res, 200, { url: `${URL_INTERNA}/descargas/${id}`, mime_type: 'audio/ogg', file_size: 16 });
  }
  return responder(res, 404, { error: { message: 'ruta desconocida', code: 100 } });
});

servidor.listen(PUERTO, () => console.log(`Meta falso en :${PUERTO}`));
