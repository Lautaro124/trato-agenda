import { describe, expect, it } from 'vitest';
import { canonizarUrl, claveDeOrigen, codigoLibre, codigoSugerido, enlaceMercadoLibre, fuenteDe } from './url.rules.js';

const u = (texto: string) => new URL(texto);

describe('enlaceMercadoLibre', () => {
  it.each([
    ['https://articulo.mercadolibre.com.ar/MLA-1234567890-mate-imperial-_JM', { tipo: 'item', sitio: 'MLA', id: 'MLA1234567890' }],
    ['https://www.mercadolibre.com.ar/mate-imperial/p/MLA12345678', { tipo: 'catalogo', sitio: 'MLA', id: 'MLA12345678' }],
    [
      'https://www.mercadolibre.com.ar/mate/p/MLA12345678?pdp_filters=item_id:MLA9876543210',
      { tipo: 'item', sitio: 'MLA', id: 'MLA9876543210' },
    ],
    ['https://www.mercadolibre.com.ar/mate/p/MLA12345678#wid=MLA111222333', { tipo: 'item', sitio: 'MLA', id: 'MLA111222333' }],
    ['https://produto.mercadolivre.com.br/MLB-998877665-tenis', { tipo: 'item', sitio: 'MLB', id: 'MLB998877665' }],
    ['https://listado.mercadolibre.com.ar/_CustId_123456', { tipo: 'listado', sitio: 'MLA', filtro: { vendedor: '123456' } }],
    ['https://www.mercadolibre.com.ar/tienda/mi-tienda', { tipo: 'listado', sitio: 'MLA', filtro: { nickname: 'mi-tienda' } }],
    ['https://listado.mercadolibre.com.ar/mate-imperial_Desde_51', { tipo: 'listado', sitio: 'MLA', filtro: { busqueda: 'mate imperial' } }],
  ])('%s', (texto, esperado) => {
    expect(enlaceMercadoLibre(u(texto))).toEqual(esperado);
  });

  it('no reconoce lo que no es de Mercado Libre ni un prefijo inventado', () => {
    expect(enlaceMercadoLibre(u('https://mercadolibre.com.ar.evil.com/MLA-1234567890'))).toBeNull();
    expect(enlaceMercadoLibre(u('https://articulo.mercadolibre.com.ar/MZZ-1234567890'))).toBeNull();
  });
});

describe('claves y códigos', () => {
  it('dos formas del mismo enlace dan la misma clave', () => {
    const a = claveDeOrigen('web', u('https://Tienda.com/p/mate?utm_source=ig&color=rojo&talle=m#fotos'), null);
    const b = claveDeOrigen('web', u('https://tienda.com/p/mate?talle=m&color=rojo&fbclid=x'), null);
    expect(a).toBe(b);
    expect(a).toMatch(/^web:[0-9a-f]{32}$/);
    expect(claveDeOrigen('web', u('https://tienda.com/p/mate?talle=l&color=rojo'), null)).not.toBe(a);
  });

  it('usa los ids de Mercado Libre y de Tiendamia', () => {
    expect(claveDeOrigen('mercadolibre', u('https://articulo.mercadolibre.com.ar/MLA-1'), 'MLA1234567890')).toBe('ml:MLA1234567890');
    expect(claveDeOrigen('tiendamia', u('https://tiendamia.com/ar/producto?amz=b0abc123&pName=x'), null)).toBe('tiendamia:amz:B0ABC123');
    expect(fuenteDe(u('https://tiendamia.com/ar/producto?amz=1'))).toBe('tiendamia');
  });

  it('canoniza sin seguimiento ni fragmento', () => {
    expect(canonizarUrl(u('https://tienda.com/x?b=2&utm_medium=a&a=1#y'))).toBe('https://tienda.com/x?a=1&b=2');
  });

  it('sugiere un código y le busca uno libre', () => {
    expect(codigoSugerido('Mate imperial ¡premium!', null)).toBe('MATE-IMPERIAL-PREMIUM');
    expect(codigoSugerido('🧉', null)).toBe('PRODUCTO');
    expect(codigoSugerido('Mate', 'MLA123')).toBe('MLA123');
    expect(codigoLibre('MATE', new Set(['MATE', 'MATE-2']))).toBe('MATE-3');
  });
});
