import { describe, expect, it } from 'vitest';
import {
  idsDeBusqueda,
  idsDePaginaDeTienda,
  itemDeCatalogo,
  itemsDeMultiget,
  productoDesdeItem,
  productosDeTarjetas,
} from './mercadolibre.rules.js';

describe('reglas de Mercado Libre', () => {
  it('una publicación sin variaciones es una variante única; otra moneda deja el precio vacío', () => {
    expect(productoDesdeItem({ id: 'MLA1234567', title: 'Taza', price: 1500, currency_id: 'ARS' }, null)).toMatchObject({
      moneda: 'ARS',
      variantes: [{ nombre: '', precioCentavos: 150_000 }],
      avisos: expect.arrayContaining(['sin_descripcion', 'sin_imagen']),
    });
    expect(productoDesdeItem({ id: 'MLB1234567', title: 'Caneca', price: 50, currency_id: 'BRL' }, null)).toMatchObject({
      moneda: null,
      variantes: [{ precioCentavos: null }],
      avisos: expect.arrayContaining(['moneda_no_soportada', 'sin_precio']),
    });
  });

  it('descarta SKUs repetidos y lo que no tiene forma de publicación', () => {
    const producto = productoDesdeItem(
      {
        id: 'MLA1234567',
        title: 'Remera',
        price: 10,
        currency_id: 'USD',
        variations: [
          { price: 10, seller_custom_field: 'R', attribute_combinations: [{ name: 'Talle', value_name: 'M' }] },
          { price: 10, seller_custom_field: 'R', attribute_combinations: [{ name: 'Talle', value_name: 'L' }] },
        ],
      },
      null,
    );
    expect(producto?.variantes).toEqual([
      { nombre: 'Talle: M', sku: null, precioCentavos: 1000 },
      { nombre: 'Talle: L', sku: null, precioCentavos: 1000 },
    ]);
    expect(productoDesdeItem({ id: '<script>', title: 'x' }, null)).toBeNull();
    expect(productoDesdeItem('no', null)).toBeNull();
  });

  it('lee la ficha de catálogo, la búsqueda y el multiget sin confiar en su forma', () => {
    expect(itemDeCatalogo({ buy_box_winner: { item_id: 'MLA999999' } })).toBe('MLA999999');
    expect(itemDeCatalogo({ buy_box_winner: null })).toBeNull();
    expect(idsDeBusqueda({ results: [{ id: 'MLA1111111' }, { id: 'MLA1111111' }, { id: 'malo' }], paging: { total: 80 } }, 50)).toEqual({
      ids: ['MLA1111111'],
      total: 80,
    });
    expect(itemsDeMultiget([{ code: 200, body: { id: 'a' } }, { code: 404, body: {} }, { code: 403, body: {} }, 'x'])).toEqual({
      items: [{ id: 'a' }],
      denegados: 1,
    });
  });

  it('saca los ids de la página de una tienda oficial, sin repetir ni tomar los de las fotos u otros sitios', () => {
    const html = [
      '<a href="https://www.mercadolibre.com.ar/sillon-retro/up/MLAU3084296950?pdp_filters=item_id%3AMLA1484453779#polycard">',
      '<img src="https://http2.mlstatic.com/D_Q_NP_828253-MLA114937173930_082026-AB.webp">',
      '<a href="https://www.mercadolibre.com.ar/sillon-retro/up/MLAU3084296950?pdp_filters=item_id%3AMLA1484453779">',
      '<a href="https://articulo.mercadolibre.com.ar/MLA-1452957927-sillon-_JM">',
      '<a href="https://www.mercadolibre.com.ar/x/p/MLA12345678#wid=MLA2066028162">',
      '<a href="https://produto.mercadolivre.com.br/MLB-998877665-tenis">',
    ].join('');
    expect(idsDePaginaDeTienda(html, 'MLA', 50)).toEqual({ ids: ['MLA1484453779', 'MLA1452957927', 'MLA12345678', 'MLA2066028162'], total: 4 });
    expect(idsDePaginaDeTienda(html, 'MLA', 2)).toEqual({ ids: ['MLA1484453779', 'MLA1452957927'], total: 4 });
    expect(idsDePaginaDeTienda('<html>verificá tu cuenta</html>', 'MLA', 50)).toEqual({ ids: [], total: 0 });
  });

  it('arma productos con las tarjetas de una tienda: nombre, precio actual, foto y enlace, sin repetir', () => {
    // La forma de las tarjetas ("poly-card") de una tienda oficial de Mercado Libre.
    const tarjeta = (id: string, nombre: string, precio: string, foto = 'https://http2.mlstatic.com/D_Q_NP_2X_828253-MLA1149_082026-AB.webp') =>
      `<div class="poly-card__portada"><img class="poly-component__picture" src="${foto}" alt="" loading="lazy"/></div>` +
      `<div class="poly-card__content"><a href="https://www.mercadolibre.com.ar/sillon/up/MLAU1754006578?pdp_filters=item_id%3A${id}#polycard_client=x&amp;wid=${id}" target="_self" class="poly-component__title">${nombre}</a>` +
      `<div class="poly-component__price"><s class="andes-money-amount" aria-label="Antes: 1443010 pesos argentinos"></s>` +
      `<div class="poly-price__current"><span class="andes-money-amount" role="img" aria-label="${precio}"><span>$</span></span></div>` +
      `<span class="poly-price__installments"><span aria-label="6 cuotas de 100 pesos argentinos"></span></span></div></div>`;
    const html = [
      tarjeta('MLA1452891813', 'Sillon Esquinero Chenille &amp; Beige', 'Ahora: 999796 pesos argentinos'),
      tarjeta('MLA1452891813', 'Sillon Esquinero Chenille &amp; Beige', 'Ahora: 999796 pesos argentinos'),
      tarjeta('MLA934534739', 'Sofá Retro', '120 dólares con 50 centavos', 'javascript:alert(1)'),
      tarjeta('MLA881628899', 'Mesa ratona', '50 reales'),
      tarjeta('MLB998877665', 'Tênis', '10 reais'),
    ].join('');

    const productos = productosDeTarjetas(html, 'MLA', 50);
    expect(productos.map((producto) => producto.idExterno)).toEqual(['MLA1452891813', 'MLA934534739', 'MLA881628899']);
    const [sillon, sofa, mesa] = productos;
    expect(sillon).toMatchObject({
      nombre: 'Sillon Esquinero Chenille & Beige',
      moneda: 'ARS',
      variantes: [{ nombre: '', sku: null, precioCentavos: 99_979_600 }],
      imagenes: ['https://http2.mlstatic.com/D_Q_NP_2X_828253-MLA1149_082026-AB.webp'],
      avisos: ['sin_descripcion'],
      url: 'https://www.mercadolibre.com.ar/sillon/up/MLAU1754006578?pdp_filters=item_id%3AMLA1452891813',
    });
    // Una foto que no es https no pasa; el precio en dólares conserva los centavos.
    expect(sofa).toMatchObject({ moneda: 'USD', variantes: [{ precioCentavos: 12_050 }], imagenes: [], avisos: expect.arrayContaining(['sin_imagen']) });
    expect(mesa).toMatchObject({ moneda: null, variantes: [{ precioCentavos: null }], avisos: expect.arrayContaining(['moneda_no_soportada', 'sin_precio']) });
    expect(productosDeTarjetas(html, 'MLA', 1)).toHaveLength(1);
    expect(productosDeTarjetas('<html>verificá tu cuenta</html>', 'MLA', 50)).toEqual([]);
  });
});
