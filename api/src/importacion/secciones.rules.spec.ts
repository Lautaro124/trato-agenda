import { describe, expect, it } from 'vitest';
import { claveDeSeccion, leerSecciones, paginaParaIa, piezasDe } from './secciones.rules.js';

const base = new URL('https://sillones.com.ar/');

/** Lo esencial de una landing de Elementor real: un hero, reseñas con fotos, la grilla de modelos y medios de pago. */
const LANDING = `
<html><head><title>Sillones</title><script>var x = "<h2>No</h2>";</script></head><body>
<nav><img src="/logo.png"><a href="#modelos">Modelos</a></nav>
<h1>Sillones directos de fábrica</h1><img src="/wp-content/uploads/hero.webp">
<h2>Reputación en Google</h2>
<img src="https://lh3.googleusercontent.com/a/uno=w40-h40"><p>Excelente, 187 reseñas</p>
<img src="https://lh3.googleusercontent.com/a/dos=w40-h40"><p>Muy buena atención</p>
<h2>Elegí el estilo que más te guste y hagámoslo a tu medida</h2>
<p>Diseñamos cada modelo para tu hogar.</p>
<div class="elementor-widget"><h2 class="elementor-heading-title">Línea Retro</h2>
  <img src="data:image/svg+xml,%3Csvg%3E" data-lazy-src="/wp-content/uploads/retro-1024x1024.webp" alt="Retro">
  <div><span>Un Cuerpo:</span></div><div><span>100 x 80 x 90 cm</span></div>
  <div><span>Retro Personalizado:</span></div><div><span>Medidas a pedido</span></div>
  <a href="https://wa.me/1"><span>Cotizar a Medida</span></a></div>
<div class="elementor-widget"><h2>Línea Americano</h2>
  <img src="/wp-content/uploads/americano.webp">
  <div>Dos Cuerpos:</div><div>140 x 70 x 70 cm</div><div>Desde $ 450.000</div></div>
<div class="elementor-widget"><h2>Línea &amp; Kiev</h2>
  <img src="/wp-content/uploads/kiev.webp"><div>Tres Cuerpos: Medida estándar</div></div>
<h2>Aceptamos todos los medios de pago</h2><h3>Pago en efectivo</h3><p>15% de descuento</p>
<img src="/wp-content/uploads/favicon-1.svg">
<footer><h2>Contacto</h2><img src="/wp-content/uploads/mapa.webp"></footer>
</body></html>`;

describe('secciones de una landing', () => {
  it('lee la grilla de modelos con su foto y sus medidas, y deja afuera las reseñas, el logo y los medios de pago', () => {
    const { productos, recortado } = leerSecciones(piezasDe(LANDING, base));
    expect(recortado).toBe(false);
    expect(productos.map((producto) => producto.nombre)).toEqual(['Línea Retro', 'Línea Americano', 'Línea & Kiev']);
    const [retro, americano, kiev] = productos;
    expect(retro).toMatchObject({
      descripcion: 'Un Cuerpo: 100 x 80 x 90 cm\nRetro Personalizado: Medidas a pedido\nCotizar a Medida',
      imagenes: ['https://sillones.com.ar/wp-content/uploads/retro-1024x1024.webp'],
      moneda: null,
      variantes: [{ nombre: '', sku: null, precioCentavos: null }],
      avisos: ['sin_precio', 'parece_a_medida'],
      seccion: 'linea-retro',
    });
    // El monto de la página no llega a la descripción ni se toma como precio.
    expect(americano.descripcion).toBe('Dos Cuerpos: 140 x 70 x 70 cm\nDesde');
    expect(americano.avisos).toEqual(['sin_precio']);
    expect(kiev.seccion).toBe('linea-kiev');
  });

  it('acepta la foto antes del título, y no inventa productos con una sola sección', () => {
    const grilla = ['Mate', 'Termo', 'Bombilla'].map((nombre) => `<div><img src="/${nombre}.jpg"><h3>${nombre}</h3><p>De algarrobo</p></div>`).join('');
    expect(leerSecciones(piezasDe(`<h2>Productos</h2>${grilla}`, base)).productos.map((producto) => [producto.nombre, producto.imagenes[0]])).toEqual([
      ['Mate', 'https://sillones.com.ar/Mate.jpg'],
      ['Termo', 'https://sillones.com.ar/Termo.jpg'],
      ['Bombilla', 'https://sillones.com.ar/Bombilla.jpg'],
    ]);
    expect(leerSecciones(piezasDe('<h2>Sobre nosotros</h2><img src="/equipo.jpg"><p>Hola</p>', base)).productos).toEqual([]);
  });

  it('no pide fotos a hosts internos ni sigue un HTML sin cerrar', () => {
    const piezas = piezasDe('<h2>Uno</h2><img src="http://10.0.0.1/a.jpg"><h2>Dos</h2><img src="https://localhost/b.jpg"><h2>Tres<script>', base);
    expect(piezas.filter((pieza) => pieza.tipo === 'imagen')).toEqual([]);
    expect(leerSecciones(piezas).productos).toEqual([]);
  });

  it('una página armada con miles de títulos sin cerrar se lee en tiempo lineal', () => {
    const html = `${'<h2>x<img src="/a.jpg">'.repeat(60_000)}</h2>`;
    const inicio = performance.now();
    piezasDe(html, base);
    expect(performance.now() - inicio).toBeLessThan(1500);
    const sinCierre = performance.now();
    piezasDe('<h2>'.repeat(200_000), base);
    expect(performance.now() - sinCierre).toBeLessThan(1500);
  });

  it('arma el texto para la IA con las fotos numeradas', () => {
    const { texto, imagenes } = paginaParaIa(piezasDe(LANDING, base));
    expect(imagenes[0]).toBe('https://sillones.com.ar/wp-content/uploads/hero.webp');
    expect(texto).toContain('## Línea Retro\n[foto 3]');
    expect(texto).not.toContain('<h2>No</h2>');
  });

  it('la clave de una sección es estable y sin tildes', () => {
    expect(claveDeSeccion('Línea Ñandú (3 y 4 cuerpos)')).toBe('linea-nandu-3-y-4-cuerpos');
    expect(claveDeSeccion('🛋️')).toBe('seccion');
  });
});
