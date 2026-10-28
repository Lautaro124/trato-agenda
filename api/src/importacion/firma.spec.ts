import { describe, expect, it } from 'vitest';
import { firmaValida, firmarBorrador, VIGENCIA_FIRMA_MS } from './firma.js';

const CLAVE = 'a'.repeat(64);
const AHORA = Date.parse('2026-10-21T15:00:00Z');
const datos = {
  userId: 'u-1',
  claveOrigen: 'ml:MLA123',
  origenUrl: 'https://articulo.mercadolibre.com.ar/MLA-123',
  imagenes: ['https://http2.mlstatic.com/a.jpg'],
  emitidaAt: new Date(AHORA).toISOString(),
};

describe('firma de la vista previa', () => {
  it('vale para los mismos datos y dentro de la hora', () => {
    const firma = firmarBorrador(datos, CLAVE);
    expect(firmaValida(datos, firma, CLAVE, AHORA + 1000)).toBe(true);
    expect(firmaValida(datos, firma, CLAVE, AHORA + VIGENCIA_FIRMA_MS + 1)).toBe(false);
  });

  it('no vale para otra cuenta, otra foto u otro origen, ni con otra clave', () => {
    const firma = firmarBorrador(datos, CLAVE);
    expect(firmaValida({ ...datos, userId: 'u-2' }, firma, CLAVE, AHORA)).toBe(false);
    expect(firmaValida({ ...datos, imagenes: ['http://169.254.169.254/'] }, firma, CLAVE, AHORA)).toBe(false);
    expect(firmaValida({ ...datos, claveOrigen: 'ml:MLA999' }, firma, CLAVE, AHORA)).toBe(false);
    expect(firmaValida(datos, firma, 'b'.repeat(64), AHORA)).toBe(false);
    expect(firmaValida(datos, 'corta', CLAVE, AHORA)).toBe(false);
  });
});
