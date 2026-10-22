/**
 * Qué es un enlace antes de pedirlo: de qué sitio, si es un producto o un
 * listado, y con qué clave estable se lo reconoce si se lo vuelve a importar
 * (Producto.origenId). Puro: no toca la red.
 */
import { createHash } from 'node:crypto';
import { LARGOS, normalizarTexto } from '../comercio/catalogo.rules.js';
import type { FuenteImportacion } from './modelo.js';

/** Dominios de Mercado Libre por país; el sitio de la API sale del prefijo del id (MLA, MLM…). */
const DOMINIOS_MERCADOLIBRE = [
  'mercadolibre.com.ar',
  'mercadolibre.com.mx',
  'mercadolibre.com.uy',
  'mercadolibre.cl',
  'mercadolibre.com.co',
  'mercadolibre.com.pe',
  'mercadolibre.com.ve',
  'mercadolibre.com.ec',
  'mercadolivre.com.br',
] as const;

const SITIO_POR_DOMINIO: Record<(typeof DOMINIOS_MERCADOLIBRE)[number], string> = {
  'mercadolibre.com.ar': 'MLA',
  'mercadolibre.com.mx': 'MLM',
  'mercadolibre.com.uy': 'MLU',
  'mercadolibre.cl': 'MLC',
  'mercadolibre.com.co': 'MCO',
  'mercadolibre.com.pe': 'MPE',
  'mercadolibre.com.ve': 'MLV',
  'mercadolibre.com.ec': 'MEC',
  'mercadolivre.com.br': 'MLB',
};

const SITIOS_ML = new Set(Object.values(SITIO_POR_DOMINIO));

/** Parámetros que sólo sirven para seguimiento: no cambian el producto, así que no cambian la clave. */
const PARAMETROS_DE_SEGUIMIENTO = /^(utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|ref|ref_|tracking_id|searchvariation|position|search_layout|type|sid|polycard_client|c_id|c_uid|c_.*)$/i;

function dominioMl(host: string): (typeof DOMINIOS_MERCADOLIBRE)[number] | null {
  return DOMINIOS_MERCADOLIBRE.find((dominio) => host === dominio || host.endsWith(`.${dominio}`)) ?? null;
}

export function esTiendamia(host: string): boolean {
  return host === 'tiendamia.com' || host.endsWith('.tiendamia.com');
}

export type EnlaceMercadoLibre =
  | { tipo: 'item'; sitio: string; id: string }
  /** Una ficha de catálogo (/p/MLA…): se resuelve a la publicación que la vende. */
  | { tipo: 'catalogo'; sitio: string; id: string }
  | { tipo: 'listado'; sitio: string; filtro: { vendedor: string } | { nickname: string } | { busqueda: string } };

/** "MLA-123456789" o "MLA123456789" → "MLA123456789", si el prefijo es de un sitio. */
function idDeItem(texto: string): string | null {
  const encontrado = /\b(M[A-Z]{2})-?(\d{6,15})\b/.exec(texto);
  if (!encontrado || !SITIOS_ML.has(encontrado[1])) return null;
  return `${encontrado[1]}${encontrado[2]}`;
}

/**
 * Lo que dice un enlace de Mercado Libre: una publicación, una ficha de
 * catálogo o un listado (de un vendedor, de una tienda o de una búsqueda).
 * Null si no es de Mercado Libre o no se reconoce.
 */
export function enlaceMercadoLibre(url: URL): EnlaceMercadoLibre | null {
  const host = url.hostname.toLowerCase();
  const dominio = dominioMl(host);
  if (!dominio) return null;
  const sitio = SITIO_POR_DOMINIO[dominio];
  let ruta = url.pathname;
  try {
    ruta = decodeURIComponent(url.pathname);
  } catch {
    // Un "%" suelto no es motivo para no reconocer el resto.
  }

  // Una ficha que ya dice qué publicación se eligió (wid / item_id, a veces codificado en pdp_filters) es esa publicación.
  let consulta = `${url.search} ${url.hash}`;
  try {
    consulta = decodeURIComponent(consulta);
  } catch {
    // Igual que la ruta: se lee lo que se pueda.
  }
  const conElegida = /(?:wid|item_id)[=:]\s?(M[A-Z]{2}-?\d{6,15})\b/i.exec(consulta);
  const elegida = conElegida ? idDeItem(conElegida[1]) : null;
  const catalogo = /\/p\/(M[A-Z]{2}\d{6,15})\b/.exec(ruta);
  if (catalogo) {
    if (elegida) return { tipo: 'item', sitio, id: elegida };
    return SITIOS_ML.has(catalogo[1].slice(0, 3)) ? { tipo: 'catalogo', sitio, id: catalogo[1] } : null;
  }
  // Un "producto de usuario" (/up/MLAU…), que es como enlazan las tiendas oficiales: sólo sirve con la publicación elegida.
  if (/\/up\/M[A-Z]{2}U\d{6,15}\b/i.test(ruta)) return elegida ? { tipo: 'item', sitio, id: elegida } : null;

  const vendedor = /_CustId_(\d{1,15})/i.exec(ruta);
  if (vendedor) return { tipo: 'listado', sitio, filtro: { vendedor: vendedor[1] } };
  const tienda = /^\/(?:tienda|pagina)\/([a-z0-9._-]{2,60})/i.exec(ruta);
  if (tienda) return { tipo: 'listado', sitio, filtro: { nickname: tienda[1] } };
  if (host.startsWith('listado.')) {
    const termino = ruta.split('/').filter(Boolean)[0]?.split('_')[0]?.replace(/-/g, ' ').trim();
    return termino ? { tipo: 'listado', sitio, filtro: { busqueda: termino.slice(0, 120) } } : null;
  }

  const item = idDeItem(ruta);
  return item ? { tipo: 'item', sitio, id: item } : null;
}

export function fuenteDe(url: URL): FuenteImportacion {
  const host = url.hostname.toLowerCase();
  if (dominioMl(host)) return 'mercadolibre';
  if (esTiendamia(host)) return 'tiendamia';
  return 'web';
}

/** La URL sin fragmento, sin parámetros de seguimiento y con los demás ordenados: dos formas del mismo enlace dan lo mismo. */
export function canonizarUrl(url: URL): string {
  const copia = new URL(url.href);
  copia.hash = '';
  copia.hostname = copia.hostname.toLowerCase();
  const parametros = [...copia.searchParams.entries()]
    .filter(([clave]) => !PARAMETROS_DE_SEGUIMIENTO.test(clave))
    .sort(([a], [b]) => a.localeCompare(b));
  copia.search = '';
  for (const [clave, valor] of parametros) copia.searchParams.append(clave, valor);
  return copia.href;
}

/** El producto de Tiendamia ("amz:B0…", "wrt:123"), de los parámetros o de la ruta. */
function idDeTiendamia(url: URL): string | null {
  for (const tienda of ['amz', 'wrt', 'eby', 'ebay', 'mcy', 'bby']) {
    const valor = url.searchParams.get(tienda);
    if (valor && /^[a-z0-9-]{3,40}$/i.test(valor)) return `${tienda}:${valor.toUpperCase()}`;
  }
  const ruta = /\/(amz|wrt|eby|ebay|mcy|bby)\/([a-z0-9-]{3,40})/i.exec(url.pathname);
  return ruta ? `${ruta[1].toLowerCase()}:${ruta[2].toUpperCase()}` : null;
}

/**
 * La clave con la que se reconoce un producto importado aunque se lo vuelva
 * a importar desde otra forma del enlace: el id de la publicación de Mercado
 * Libre, el del producto en Tiendamia, o un hash de la URL canónica (y de la
 * sección, si salió de una landing con varios productos).
 */
export function claveDeOrigen(fuente: FuenteImportacion, url: URL, idExterno: string | null, seccion: string | null = null): string {
  if (fuente === 'mercadolibre' && idExterno) return `ml:${idExterno}`;
  if (fuente === 'tiendamia' && !seccion) {
    const id = idDeTiendamia(url);
    if (id) return `tiendamia:${id}`;
  }
  // Las secciones de una misma landing comparten la URL: la sección las distingue.
  const hash = createHash('sha256')
    .update(seccion ? `${canonizarUrl(url)}#${seccion}` : canonizarUrl(url))
    .digest('hex')
    .slice(0, 32);
  return `${fuente === 'tiendamia' ? 'tiendamia' : 'web'}:${hash}`;
}

/**
 * Un código para el catálogo: el id de la publicación si lo hay ("MLA123…"),
 * o el nombre en mayúsculas ("Mate imperial" → "MATE-IMPERIAL"). El
 * servicio le agrega "-2", "-3"… si ya está usado.
 */
export function codigoSugerido(nombre: string, idExterno: string | null): string {
  if (idExterno) return idExterno.slice(0, LARGOS.codigo);
  const base = normalizarTexto(nombre)
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return base || 'PRODUCTO';
}

/** El primer código libre: el sugerido, o con "-2", "-3"… */
export function codigoLibre(sugerido: string, usados: ReadonlySet<string>): string {
  if (!usados.has(sugerido)) return sugerido;
  for (let n = 2; n < 1000; n++) {
    const candidato = `${sugerido.slice(0, LARGOS.codigo - String(n).length - 1)}-${n}`;
    if (!usados.has(candidato)) return candidato;
  }
  return `${sugerido.slice(0, LARGOS.codigo - 9)}-${Date.now().toString(36)}`;
}
