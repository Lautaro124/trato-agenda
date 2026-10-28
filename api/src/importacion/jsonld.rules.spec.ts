import { describe, expect, it } from 'vitest';
import { leerHtml } from './html.rules.js';
import { leerJsonLd, leerMetas, precioDe } from './jsonld.rules.js';

const BASE = new URL('https://tienda.ejemplo.com/productos/mate');

function pagina(...bloques: unknown[]): string {
  return (
    '<html><head><title>x</title>' +
    bloques.map((bloque) => `<script type="application/ld+json">${JSON.stringify(bloque)}</script>`).join('') +
    '</head><body></body></html>'
  );
}

describe('leerHtml', () => {
  it('saca los bloques JSON-LD, las meta y el canonical', () => {
    const html =
      '<head><meta property="og:title" content="Mate &amp; bombilla"><META name=description content=\'Rico\'>' +
      '<metadata>no</metadata><link rel="canonical" href="/mate"><script>var x = 1</script>' +
      '<script type="application/ld+json">{"@type":"Product"}</script></head>';
    const leido = leerHtml(html);
    expect(leido.jsonld).toEqual(['{"@type":"Product"}']);
    expect(leido.metas.get('og:title')).toBe('Mate & bombilla');
    expect(leido.metas.get('description')).toBe('Rico');
    expect(leido.canonical).toBe('/mate');
  });

  it('miles de <script> sin cerrar no lo vuelven cuadrático', () => {
    const inicio = Date.now();
    expect(leerHtml(`${'<script>'.repeat(250_000)}</script>`).jsonld).toEqual([]);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('una letra que cambia de largo al pasar a minúsculas no desalinea los bloques', () => {
    const html = `<p>${'İ'.repeat(50)}</p><script type="application/ld+json">{"@type":"Product"}</script>`;
    expect(leerHtml(html).jsonld).toEqual(['{"@type":"Product"}']);
  });

  it('con una etiqueta sin cerrar no se cuelga', () => {
    expect(leerHtml('<script type="application/ld+json">{').jsonld).toEqual([]);
    expect(leerHtml('<meta '.repeat(10_000)).metas.size).toBe(0);
  });
});

describe('leerJsonLd', () => {
  it('lee un producto con su precio, moneda, fotos y categoría', () => {
    const resultado = leerJsonLd(
      leerHtml(
        pagina({
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Mate imperial <b>premium</b>',
          description: 'Calabaza forrada en cuero. Antes $ 30.000.',
          sku: 'MATE-IMP',
          category: 'Hogar > Mates',
          image: ['/img/mate.jpg', 'http://otro.com/no-https.jpg', { url: 'https://cdn.ejemplo.com/mate2.jpg' }],
          offers: { '@type': 'Offer', price: '25000.50', priceCurrency: 'ARS', availability: 'https://schema.org/InStock' },
        }),
      ).jsonld,
      BASE,
    );
    expect(resultado).toMatchObject({
      tipo: 'producto',
      producto: {
        nombre: 'Mate imperial premium',
        categoria: 'Mates',
        moneda: 'ARS',
        variantes: [{ nombre: '', sku: 'MATE-IMP', precioCentavos: 2_500_050 }],
        imagenes: ['https://tienda.ejemplo.com/img/mate.jpg', 'https://cdn.ejemplo.com/mate2.jpg'],
        avisos: [],
      },
    });
    // Los montos de la descripción no llegan al catálogo.
    expect(resultado.tipo === 'producto' && resultado.producto.descripcion).not.toMatch(/30/);
  });

  it('un ProductGroup trae sus variantes, sin repetir el nombre del producto', () => {
    const resultado = leerJsonLd(
      leerHtml(
        pagina({
          '@graph': [
            {
              '@type': 'ProductGroup',
              name: 'Remera básica',
              hasVariant: [
                { '@type': 'Product', name: 'Remera básica - Talle M', sku: 'REM-M', offers: { price: 15000, priceCurrency: 'USD' } },
                { '@type': 'Product', name: 'Remera básica - Talle L', sku: 'REM-L', offers: { price: 16000, priceCurrency: 'USD' } },
              ],
            },
          ],
        }),
      ).jsonld,
      BASE,
    );
    expect(resultado).toMatchObject({
      tipo: 'producto',
      producto: {
        nombre: 'Remera básica',
        moneda: 'USD',
        variantes: [
          { nombre: 'Talle M', sku: 'REM-M', precioCentavos: 1_500_000 },
          { nombre: 'Talle L', sku: 'REM-L', precioCentavos: 1_600_000 },
        ],
      },
    });
  });

  it('otra moneda deja el precio vacío y avisa; sin moneda, también avisa', () => {
    const enEuros = leerJsonLd(leerHtml(pagina({ '@type': 'Product', name: 'Taza', offers: { price: 10, priceCurrency: 'EUR' } })).jsonld, BASE);
    expect(enEuros).toMatchObject({
      tipo: 'producto',
      producto: { moneda: null, variantes: [{ precioCentavos: null }], avisos: expect.arrayContaining(['moneda_no_soportada', 'sin_precio']) },
    });
    const sinMoneda = leerJsonLd(leerHtml(pagina({ '@type': 'Product', name: 'Taza', offers: { price: 10 } })).jsonld, BASE);
    expect(sinMoneda).toMatchObject({ tipo: 'producto', producto: { moneda: null, avisos: expect.arrayContaining(['sin_moneda']) } });
  });

  it('un ItemList da las URLs del mismo sitio, nunca de otro', () => {
    const resultado = leerJsonLd(
      leerHtml(
        pagina({
          '@type': 'ItemList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, url: '/productos/a' },
            { '@type': 'ListItem', position: 2, item: { '@id': 'https://tienda.ejemplo.com/productos/b' } },
            { '@type': 'ListItem', position: 3, url: 'https://otro-sitio.com/productos/c' },
            { '@type': 'ListItem', position: 4, url: 'https://169.254.169.254/latest' },
          ],
        }),
      ).jsonld,
      BASE,
    );
    expect(resultado).toEqual({
      tipo: 'listado',
      urls: ['https://tienda.ejemplo.com/productos/a', 'https://tienda.ejemplo.com/productos/b'],
      recortado: false,
    });
  });

  it('un JSON roto o enorme no tira nada ni se cuelga', () => {
    let anidado: unknown = { '@type': 'Product', name: 'Hondo', offers: { price: 1, priceCurrency: 'ARS' } };
    for (let i = 0; i < 50; i++) anidado = { a: anidado };
    expect(leerJsonLd(['{roto', JSON.stringify(anidado)], BASE)).toEqual({ tipo: 'nada' });
    expect(leerJsonLd([JSON.stringify({ '@type': 'Product', name: 'x' })], BASE)).toEqual({ tipo: 'nada' });
  });

  it('un arreglo gigante no se recorre entero', () => {
    const enorme = JSON.stringify([...Array.from({ length: 200_000 }, () => ({})), { '@type': 'Product', name: 'Escondido' }]);
    const inicio = Date.now();
    expect(leerJsonLd([enorme], BASE)).toEqual({ tipo: 'nada' });
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('no deja que "__proto__" o "constructor" pasen por campos', () => {
    const malicioso = '{"@type":"Product","name":"Mate","__proto__":{"offers":{"price":1,"priceCurrency":"ARS"}}}';
    expect(leerJsonLd([malicioso], BASE)).toMatchObject({ tipo: 'producto', producto: { variantes: [{ precioCentavos: null }] } });
  });
});

describe('leerMetas', () => {
  it('arma el producto con Open Graph cuando no hay JSON-LD', () => {
    const { metas } = leerHtml(
      '<meta property="og:type" content="product"><meta property="og:title" content="Taza"><meta property="product:price:amount" content="1.500"><meta property="product:price:currency" content="ARS"><meta property="og:image" content="https://cdn.ejemplo.com/taza.jpg">',
    );
    expect(leerMetas(metas, BASE)).toMatchObject({
      nombre: 'Taza',
      moneda: 'ARS',
      variantes: [{ precioCentavos: 150_000 }],
      imagenes: ['https://cdn.ejemplo.com/taza.jpg'],
    });
  });

  it('una página que no es de producto no da nada', () => {
    expect(leerMetas(leerHtml('<meta property="og:title" content="Blog">').metas, BASE)).toBeNull();
  });
});

describe('precioDe', () => {
  it.each([
    [1500, 150_000],
    ['1500.50', 150_050],
    ['1.500,50', 150_050],
    [-1, null],
    [Number.NaN, null],
    ['gratis', null],
    [{}, null],
  ])('%s → %s', (valor, centavos) => {
    expect(precioDe(valor)).toBe(centavos);
  });
});
