/**
 * Lo poco que la importación lee del HTML de una página: los bloques JSON-LD
 * (schema.org, donde las tiendas publican sus productos para Google), las
 * etiquetas <meta> de Open Graph y de producto, y el canonical. No hace
 * falta un parser entero: se recorre el texto con indexOf, sin regex que
 * puedan volverse cuadráticas con una página armada para eso, y con topes de
 * cantidad y de tamaño.
 */
import { decodificarEntidades } from './texto.rules.js';

/** Bloques JSON-LD que se leen por página, y el tamaño máximo de cada uno. */
export const MAX_BLOQUES_JSONLD = 20;
export const MAX_BYTES_BLOQUE = 512 * 1024;
const MAX_METAS = 300;

export type HtmlLeido = {
  jsonld: string[];
  /** og:title, product:price:amount, description… → contenido (la primera vez que aparece). */
  metas: Map<string, string>;
  canonical: string | null;
};

/** Los atributos de una etiqueta ya cortada ("<meta property=og:title content='x'>"), en minúsculas el nombre. */
export function atributos(etiqueta: string): Map<string, string> {
  const salida = new Map<string, string>();
  let i = etiqueta.indexOf(' ');
  if (i === -1) return salida;
  const largo = etiqueta.length;
  while (i < largo) {
    while (i < largo && /[\s/]/.test(etiqueta[i])) i++;
    if (i >= largo || etiqueta[i] === '>') break;
    const inicioNombre = i;
    while (i < largo && !/[\s=>/]/.test(etiqueta[i])) i++;
    const nombre = etiqueta.slice(inicioNombre, i).toLowerCase();
    while (i < largo && /\s/.test(etiqueta[i])) i++;
    let valor = '';
    if (etiqueta[i] === '=') {
      i++;
      while (i < largo && /\s/.test(etiqueta[i])) i++;
      const comilla = etiqueta[i];
      if (comilla === '"' || comilla === "'") {
        const fin = etiqueta.indexOf(comilla, i + 1);
        const hasta = fin === -1 ? largo : fin;
        valor = etiqueta.slice(i + 1, hasta);
        i = hasta + 1;
      } else {
        const inicio = i;
        while (i < largo && !/[\s>]/.test(etiqueta[i])) i++;
        valor = etiqueta.slice(inicio, i);
      }
    }
    if (nombre && !salida.has(nombre)) salida.set(nombre, decodificarEntidades(valor));
  }
  return salida;
}

/** Cada etiqueta `<nombre …>` del documento, ya cortada, con la posición donde termina. */
function* etiquetas(html: string, minusculas: string, nombre: string): Generator<{ etiqueta: string; fin: number }> {
  const apertura = `<${nombre}`;
  let desde = 0;
  for (;;) {
    const inicio = minusculas.indexOf(apertura, desde);
    if (inicio === -1) return;
    const siguiente = minusculas[inicio + apertura.length];
    const cierre = html.indexOf('>', inicio);
    if (cierre === -1) return;
    desde = cierre + 1;
    // "<metadata" no es "<meta".
    if (siguiente !== undefined && !/[\s/>]/.test(siguiente)) continue;
    yield { etiqueta: html.slice(inicio, cierre + 1), fin: cierre + 1 };
  }
}

export function leerHtml(html: string): HtmlLeido {
  // Sólo A-Z: toLowerCase de Unicode puede cambiar el largo ("İ") y desalinear los índices.
  const minusculas = html.replace(/[A-Z]+/g, (letras) => letras.toLowerCase());

  // Cada <script> se salta entero hasta su </script>: con el generador, mil aperturas sin cerrar
  // volverían a buscar el mismo cierre lejano cada vez (cuadrático).
  const jsonld: string[] = [];
  let desde = 0;
  for (;;) {
    const inicio = minusculas.indexOf('<script', desde);
    if (inicio === -1) break;
    const finApertura = html.indexOf('>', inicio);
    if (finApertura === -1) break;
    const cierre = minusculas.indexOf('</script', finApertura + 1);
    if (cierre === -1) break;
    desde = cierre + '</script'.length;
    const siguiente = minusculas[inicio + '<script'.length];
    if (siguiente !== undefined && !/[\s/>]/.test(siguiente)) continue;
    const tipo = (atributos(html.slice(inicio, finApertura + 1)).get('type') ?? '').trim().toLowerCase();
    if (tipo === 'application/ld+json' && cierre - (finApertura + 1) <= MAX_BYTES_BLOQUE) {
      jsonld.push(html.slice(finApertura + 1, cierre));
      if (jsonld.length >= MAX_BLOQUES_JSONLD) break;
    }
  }

  const metas = new Map<string, string>();
  for (const { etiqueta } of etiquetas(html, minusculas, 'meta')) {
    const valores = atributos(etiqueta);
    const clave = (valores.get('property') ?? valores.get('name') ?? valores.get('itemprop') ?? '').trim().toLowerCase();
    const contenido = valores.get('content');
    if (clave && contenido !== undefined && !metas.has(clave)) metas.set(clave, contenido);
    if (metas.size >= MAX_METAS) break;
  }

  let canonical: string | null = null;
  for (const { etiqueta } of etiquetas(html, minusculas, 'link')) {
    const valores = atributos(etiqueta);
    if ((valores.get('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical') && valores.get('href')) {
      canonical = valores.get('href') ?? null;
      break;
    }
  }

  return { jsonld, metas, canonical };
}
