// Tienda y Mercado Libre falsos para los E2E de la importación rápida
// (LAU-31). La API los pide por la red de compose (importacion-stub:4030),
// habilitados sólo con IMPORTACION_HOSTS_DE_PRUEBA, que en producción no
// puede estar puesta.
//
//   - /tienda/…: páginas de producto con JSON-LD (en pesos, en dólares con
//     variantes, sin precio), un listado (ItemList), una sin datos de
//     producto, una que redirige a la metadata de la nube y la foto;
//   - /ml/…: lo que la API lee de api.mercadolibre.com (una publicación con
//     variaciones, su descripción, la búsqueda por vendedor y el multiget).
//
// Sin dependencias: corre con `node server.mjs` o dentro de node:24-alpine.
import http from 'node:http';

const PUERTO = Number(process.env.PORT ?? 4030);

const FOTO = Buffer.from(
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCgBOUAAAAAAH//2Q==',
  'base64',
);

const PRODUCTOS = {
  mate: {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Mate imperial de calabaza',
    description: 'Calabaza forrada en cuero, con virola de alpaca.',
    sku: 'MATE-IMP',
    category: 'Hogar > Mates',
    image: '/tienda/mate.jpg',
    offers: { '@type': 'Offer', price: '25000', priceCurrency: 'ARS' },
  },
  auriculares: {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: 'Auriculares inalámbricos',
    description: 'Bluetooth, con estuche de carga.',
    hasVariant: [
      { '@type': 'Product', name: 'Auriculares inalámbricos - Negro', sku: 'AURI-N', offers: { price: 25, priceCurrency: 'USD' } },
      { '@type': 'Product', name: 'Auriculares inalámbricos - Blanco', sku: 'AURI-B', offers: { price: 27, priceCurrency: 'USD' } },
    ],
  },
  'sin-precio': {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Taza de cerámica',
    description: 'Hecha a mano.',
    offers: { '@type': 'Offer', priceCurrency: 'ARS' },
  },
  categoria: {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, url: '/tienda/mate' },
      { '@type': 'ListItem', position: 2, url: '/tienda/auriculares' },
    ],
  },
};

const ITEM_ML = {
  id: 'MLA1234567890',
  title: 'Termo de acero 1 litro',
  price: 120000,
  currency_id: 'ARS',
  permalink: 'https://articulo.mercadolibre.com.ar/MLA-1234567890-termo-de-acero-1-litro-_JM',
  pictures: [],
  variations: [
    { id: 1, price: 120000, attribute_combinations: [{ name: 'Color', value_name: 'Verde' }], seller_custom_field: 'TER-V' },
    { id: 2, price: 125000, attribute_combinations: [{ name: 'Color', value_name: 'Negro' }], seller_custom_field: 'TER-N' },
  ],
};

function responder(res, status, cuerpo, tipo = 'application/json') {
  res.writeHead(status, { 'Content-Type': tipo });
  res.end(typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
}

function pagina(dato) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tienda de prueba</title>
<script type="application/ld+json">${JSON.stringify(dato)}</script></head><body><h1>Tienda de prueba</h1></body></html>`;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`);
  const ruta = url.pathname;

  if (ruta === '/health') return responder(res, 200, { status: 'ok' });

  if (ruta === '/tienda/mate.jpg') return responder(res, 200, FOTO, 'image/jpeg');
  if (ruta === '/tienda/blog') return responder(res, 200, '<!doctype html><html><head><title>Blog</title></head><body>Hola</body></html>', 'text/html; charset=utf-8');
  if (ruta === '/tienda/a-la-metadata') {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    return res.end();
  }
  const producto = ruta.match(/^\/tienda\/([\w-]+)$/);
  if (producto && Object.hasOwn(PRODUCTOS, producto[1])) return responder(res, 200, pagina(PRODUCTOS[producto[1]]), 'text/html; charset=utf-8');

  // --- API de Mercado Libre ---
  if (ruta === '/ml/oauth/token' && req.method === 'POST') return responder(res, 200, { access_token: 'APP_USR-stub', expires_in: 21600 });
  if (ruta === `/ml/items/${ITEM_ML.id}`) return responder(res, 200, ITEM_ML);
  if (ruta === `/ml/items/${ITEM_ML.id}/description`) return responder(res, 200, { plain_text: 'Mantiene el agua caliente 24 horas.' });
  if (ruta === '/ml/items') {
    const ids = (url.searchParams.get('ids') ?? '').split(',');
    return responder(res, 200, ids.map((id) => (id === ITEM_ML.id ? { code: 200, body: ITEM_ML } : { code: 404, body: {} })));
  }
  if (ruta === '/ml/sites/MLA/search') return responder(res, 200, { results: [{ id: ITEM_ML.id }], paging: { total: 1 } });

  return responder(res, 404, { message: `Ruta desconocida: ${req.method} ${ruta}` });
});

servidor.listen(PUERTO, '0.0.0.0', () => console.log(`Tienda falsa escuchando en :${PUERTO}`));

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
