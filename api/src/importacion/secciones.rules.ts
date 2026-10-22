/**
 * Páginas sin datos de producto (ni JSON-LD ni <meta> de producto): landings
 * armadas con un constructor visual (Elementor, Wix…) que muestran sus
 * modelos como secciones, cada una con un título, una foto y un texto, y sin
 * página propia ni precio. Se las lee como "tarjetas": un encabezado con la
 * primera foto y el texto que lo siguen hasta el próximo encabezado de su
 * nivel. Si no salen tarjetas, la página se pasa (como texto y una lista de
 * fotos) a la extracción con IA (extraccion-ia.ts).
 *
 * Puro y lineal, como html.rules.ts: se recorre con indexOf, sin regex que
 * puedan volverse cuadráticas, y con topes.
 */
import { LARGOS } from '../comercio/catalogo.rules.js';
import { atributos } from './html.rules.js';
import { urlUtil } from './jsonld.rules.js';
import { MAX_PRODUCTOS_LISTADO_WEB, type AvisoBorrador, type ProductoExtraido } from './modelo.js';
import { sinEtiquetas, textoSeguro } from './texto.rules.js';

/** Piezas que se leen por página y fotos que se ofrecen a la IA. */
const MAX_PIEZAS = 6000;
export const MAX_IMAGENES_PAGINA = 40;
/** Lo que puede ocupar un encabezado en el HTML, con sus etiquetas internas. */
const LARGO_MAX_ENCABEZADO = 4000;
/** Un encabezado más largo que esto es una frase, no el nombre de un producto. */
const LARGO_MAX_NOMBRE_SECCION = 80;
/** Lo que se le pasa a la IA de texto visible. */
export const MAX_TEXTO_PAGINA = 30_000;

/** Lo que no se ve: se salta entero hasta su cierre. */
const OCULTOS = new Set(['script', 'style', 'svg', 'noscript', 'template', 'iframe', 'head', 'select', 'button', 'form', 'nav', 'footer']);
const ENCABEZADOS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Las que cortan el texto en otro renglón; las demás (span, a, strong…) sólo lo separan con un espacio. */
const BLOQUES = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'section', 'article', 'aside', 'main', 'header',
  'figure', 'figcaption', 'blockquote', 'table', 'tr', 'td', 'th', 'img', 'hr',
]);
/** Fotos que son parte del diseño y no de un producto. */
const DECORATIVAS = /(logo|icon|favicon|sprite|placeholder|avatar|badge|flag|loader|spinner|pixel)/i;
const A_MEDIDA = /(a\s+medida|medidas?\s+a\s+pedido|a\s+pedido|por\s+encargo|cotiz|presupuest|personaliz)/i;

export type Pieza =
  | { tipo: 'encabezado'; nivel: number; texto: string }
  | { tipo: 'imagen'; url: string }
  | { tipo: 'texto'; texto: string };

function nombreDeEtiqueta(minusculas: string, desde: number): string {
  let fin = desde;
  while (fin < minusculas.length && fin - desde < 12 && /[a-z0-9]/.test(minusculas[fin])) fin++;
  return minusculas.slice(desde, fin);
}

/** La URL de una foto, con lo que usan los lazy-loaders antes que el src (que suele ser un placeholder). */
function urlDeImagen(etiqueta: string, base: URL, hostsDePrueba?: ReadonlySet<string>): string | null {
  const valores = atributos(etiqueta);
  for (const clave of ['data-lazy-src', 'data-src', 'data-original', 'src']) {
    const valor = (valores.get(clave) ?? '').trim();
    if (!valor || valor.startsWith('data:')) continue;
    const url = urlUtil(valor, base, hostsDePrueba);
    if (!url) return null;
    const ruta = new URL(url).pathname.toLowerCase();
    if (ruta.endsWith('.svg') || ruta.endsWith('.gif') || DECORATIVAS.test(ruta)) return null;
    return url;
  }
  return null;
}

/** El documento → encabezados, fotos y textos visibles, en orden. */
export function piezasDe(html: string, base: URL, hostsDePrueba?: ReadonlySet<string>): Pieza[] {
  // Sólo A-Z: toLowerCase de Unicode puede cambiar el largo y desalinear los índices.
  const minusculas = html.replace(/[A-Z]+/g, (letras) => letras.toLowerCase());
  const piezas: Pieza[] = [];
  let texto = '';
  const volcar = () => {
    const limpio = textoSeguro(texto, { largo: 2000, sinMontos: true });
    if (limpio) piezas.push({ tipo: 'texto', texto: limpio });
    texto = '';
  };

  // El próximo cierre de cada etiqueta, recordado: mil "<h2>" sin cerrar no vuelven a buscar el mismo cierre lejano (cuadrático).
  const cierres = new Map<string, number>();
  const cierreDe = (nombre: string, desde: number): number => {
    const recordado = cierres.get(nombre);
    if (recordado !== undefined && (recordado === -1 || recordado >= desde)) return recordado;
    const fin = minusculas.indexOf(`</${nombre}`, desde);
    cierres.set(nombre, fin);
    return fin;
  };

  let i = 0;
  while (i < html.length && piezas.length < MAX_PIEZAS) {
    const abre = html.indexOf('<', i);
    if (abre === -1) {
      texto += html.slice(i);
      break;
    }
    texto += html.slice(i, abre);
    if (minusculas.startsWith('<!--', abre)) {
      const fin = minusculas.indexOf('-->', abre + 4);
      i = fin === -1 ? html.length : fin + 3;
      continue;
    }
    const cierra = html.indexOf('>', abre);
    if (cierra === -1) break;
    const deCierre = html[abre + 1] === '/';
    const nombre = nombreDeEtiqueta(minusculas, abre + (deCierre ? 2 : 1));
    i = cierra + 1;
    if (!nombre) continue;
    if (!BLOQUES.has(nombre) && !ENCABEZADOS.has(nombre) && !OCULTOS.has(nombre)) {
      texto += ' ';
      continue;
    }
    volcar();
    if (deCierre) continue;

    if (OCULTOS.has(nombre)) {
      const fin = cierreDe(nombre, i);
      i = fin === -1 ? html.length : fin;
      continue;
    }
    if (ENCABEZADOS.has(nombre)) {
      const fin = cierreDe(nombre, i);
      // Sin cierre cerca no es un título: se sigue leyendo lo que tiene adentro como texto.
      if (fin === -1 || fin - i > LARGO_MAX_ENCABEZADO) continue;
      const contenido = textoSeguro(sinEtiquetas(html.slice(i, fin)), { largo: 300, sinMontos: true });
      if (contenido) piezas.push({ tipo: 'encabezado', nivel: Number(nombre[1]), texto: contenido });
      i = fin;
      continue;
    }
    if (nombre === 'img') {
      const url = urlDeImagen(html.slice(abre, cierra + 1), base, hostsDePrueba);
      if (url) piezas.push({ tipo: 'imagen', url });
    }
  }
  volcar();
  return piezas;
}

type Tarjeta = { nombre: string; imagen: string; textos: string[] };

/**
 * Las tarjetas de un nivel de encabezado (la foto, después del título o justo
 * antes), en tramos: un encabezado de ese nivel que no es tarjeta corta el
 * tramo. Los productos de una landing van seguidos, uno tras otro; las
 * secciones sueltas con foto (reseñas, envíos) quedan en tramos cortos.
 */
function tramosDelNivel(piezas: Pieza[], nivel: number, fotoAntes: boolean): Tarjeta[][] {
  const tramos: Tarjeta[][] = [[]];
  const usadas = new Set<string>();
  let ultimaFoto: string | null = null;
  for (let i = 0; i < piezas.length; i++) {
    const pieza = piezas[i];
    if (pieza.tipo === 'imagen') ultimaFoto = pieza.url;
    if (pieza.tipo !== 'encabezado') continue;
    const previa = ultimaFoto;
    ultimaFoto = null;
    if (pieza.nivel !== nivel) continue;

    const textos: string[] = [];
    let foto: string | null = fotoAntes ? previa : null;
    for (let j = i + 1; j < piezas.length; j++) {
      const siguiente = piezas[j];
      if (siguiente.tipo === 'encabezado') {
        if (siguiente.nivel <= nivel) break;
        textos.push(siguiente.texto);
      } else if (siguiente.tipo === 'texto') {
        textos.push(siguiente.texto);
      } else if (!fotoAntes && !foto) {
        foto = siguiente.url;
      }
    }
    const largo = Array.from(pieza.texto).length;
    if (!foto || usadas.has(foto) || largo < 2 || largo > LARGO_MAX_NOMBRE_SECCION) {
      if (tramos[tramos.length - 1].length > 0) tramos.push([]);
      continue;
    }
    usadas.add(foto);
    tramos[tramos.length - 1].push({ nombre: pieza.texto, imagen: foto, textos });
  }
  return tramos;
}

/** "Un Cuerpo:" + "100 x 80 cm" → "Un Cuerpo: 100 x 80 cm"; lo demás, una línea por texto. */
function unirTextos(textos: string[]): string {
  let salida = '';
  for (const texto of textos) {
    if (!salida) salida = texto;
    else salida += salida.endsWith(':') ? ` ${texto}` : `\n${texto}`;
  }
  return salida;
}

/** "Línea Retro" → "linea-retro": distingue la clave de origen de cada sección de la misma página. */
export function claveDeSeccion(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'seccion'
  );
}

/** Una sección (de la heurística o de la IA) → producto sin precio, con el mismo saneamiento que el resto. */
export function productoDeSeccion(nombreCrudo: string, descripcionCruda: string, imagen: string | null, aMedida: boolean): ProductoExtraido | null {
  const nombre = textoSeguro(nombreCrudo, { largo: LARGOS.nombre, sinMontos: true });
  if (nombre.length < 2) return null;
  const descripcion = textoSeguro(descripcionCruda, { largo: LARGOS.descripcion, multilinea: true, sinMontos: true });
  const avisos: AvisoBorrador[] = ['sin_precio'];
  if (!descripcion) avisos.push('sin_descripcion');
  else if (descripcionCruda.length > LARGOS.descripcion) avisos.push('descripcion_recortada');
  if (!imagen) avisos.push('sin_imagen');
  if (aMedida || A_MEDIDA.test(`${nombreCrudo}\n${descripcionCruda}`)) avisos.push('parece_a_medida');
  return {
    nombre,
    descripcion,
    categoria: null,
    moneda: null,
    variantes: [{ nombre: '', sku: null, precioCentavos: null }],
    imagenes: imagen ? [imagen] : [],
    avisos,
    idExterno: null,
    url: null,
    seccion: claveDeSeccion(nombre),
  };
}

/**
 * Las secciones de producto de la página: el tramo de tarjetas seguidas más
 * largo de cualquier nivel de encabezado (al menos dos, cada una con su foto),
 * en el orden en que aparecen. Ante un empate gana la foto después del título.
 */
export function leerSecciones(piezas: Pieza[]): { productos: ProductoExtraido[]; recortado: boolean } {
  let mejores: Tarjeta[] = [];
  for (const nivel of [2, 3, 4, 5, 6, 1]) {
    for (const fotoAntes of [false, true]) {
      for (const tramo of tramosDelNivel(piezas, nivel, fotoAntes)) {
        if (tramo.length > mejores.length) mejores = tramo;
      }
    }
  }
  if (mejores.length < 2) return { productos: [], recortado: false };
  const productos = mejores
    .map((tarjeta) => productoDeSeccion(tarjeta.nombre, unirTextos(tarjeta.textos), tarjeta.imagen, false))
    .filter((producto): producto is ProductoExtraido => producto !== null);
  // Dos secciones con el mismo nombre serían la misma clave: queda la primera.
  const unicos = productos.filter((producto, indice) => productos.findIndex((otro) => otro.seccion === producto.seccion) === indice);
  return { productos: unicos.slice(0, MAX_PRODUCTOS_LISTADO_WEB), recortado: unicos.length > MAX_PRODUCTOS_LISTADO_WEB };
}

/**
 * Lo que ve la IA: el texto visible con las fotos marcadas por su número
 * ("[foto 3]"), recortado, y la lista de fotos. El modelo sólo puede elegir
 * números de esa lista: nunca escribe una URL.
 */
export function paginaParaIa(piezas: Pieza[]): { texto: string; imagenes: string[] } {
  const imagenes: string[] = [];
  const lineas: string[] = [];
  let largo = 0;
  for (const pieza of piezas) {
    let linea: string;
    if (pieza.tipo === 'imagen') {
      let indice = imagenes.indexOf(pieza.url);
      if (indice === -1) {
        if (imagenes.length >= MAX_IMAGENES_PAGINA) continue;
        imagenes.push(pieza.url);
        indice = imagenes.length - 1;
      }
      linea = `[foto ${indice}]`;
    } else if (pieza.tipo === 'encabezado') {
      linea = `${'#'.repeat(pieza.nivel)} ${pieza.texto}`;
    } else {
      linea = pieza.texto;
    }
    if (largo + linea.length > MAX_TEXTO_PAGINA) break;
    lineas.push(linea);
    largo += linea.length + 1;
  }
  return { texto: lineas.join('\n'), imagenes };
}
