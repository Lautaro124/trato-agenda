import { describe, expect, it } from 'vitest';
import { idsDeBusqueda, itemDeCatalogo, itemsDeMultiget, productoDesdeItem } from './mercadolibre.rules.js';

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
    expect(itemsDeMultiget([{ code: 200, body: { id: 'a' } }, { code: 404, body: {} }, 'x'])).toEqual([{ id: 'a' }]);
  });
});
