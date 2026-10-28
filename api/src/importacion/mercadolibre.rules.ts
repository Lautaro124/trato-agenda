/**
 * De la API de Mercado Libre (api.mercadolibre.com) a un producto del
 * catálogo. Puro: el cliente (mercadolibre.client.ts) trae el JSON y esto lo
 * lee sin confiar en su forma.
 *
 * - Las variaciones (talle, color) son variantes; su nombre sale de los
 *   atributos ("Talle: M / Color: Rojo").
 * - El SKU del vendedor (seller_custom_field o el atributo SELLER_SKU), si lo
 *   cargó; si no, el catálogo arma uno.
 * - El stock no se importa: Mercado Libre no muestra la cantidad real de
 *   otro vendedor, y la del propio puede no ser la de este negocio.
 * - Una moneda que no sea ARS o USD deja el precio vacío.
 */
import { esMoneda, LARGOS, MAX_VARIANTES, PRECIO_MAX_PESOS, type Moneda } from '../comercio/catalogo.rules.js';
import { revisarUrl } from './ssrf.rules.js';
import { decodificarEntidades, textoSeguro } from './texto.rules.js';
import { MAX_IMAGENES_OFRECIDAS, type AvisoBorrador, type ProductoExtraido, type VarianteExtraida } from './modelo.js';

type Json = Record<string, unknown>;

const esObjeto = (valor: unknown): valor is Json => typeof valor === 'object' && valor !== null && !Array.isArray(valor);
const campo = (objeto: Json, clave: string): unknown => (Object.hasOwn(objeto, clave) ? objeto[clave] : undefined);
const arreglo = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);
const texto = (valor: unknown): string => (typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '');

function centavos(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > PRECIO_MAX_PESOS) return null;
  return Math.round(valor * 100);
}

function skuDe(objeto: Json): string | null {
  const propio = texto(campo(objeto, 'seller_custom_field'));
  const atributo = arreglo(campo(objeto, 'attributes'))
    .filter(esObjeto)
    .find((atributo) => campo(atributo, 'id') === 'SELLER_SKU');
  const crudo = propio || (atributo ? texto(campo(atributo, 'value_name')) : '');
  return textoSeguro(crudo, { largo: LARGOS.sku, sinMontos: true }) || null;
}

function imagenesDe(item: Json): string[] {
  const salida: string[] = [];
  for (const imagen of arreglo(campo(item, 'pictures')).filter(esObjeto)) {
    const url = texto(campo(imagen, 'secure_url')) || texto(campo(imagen, 'url'));
    const revisada = url ? revisarUrl(url) : null;
    if (revisada && 'url' in revisada && !salida.includes(revisada.url.href)) salida.push(revisada.url.href);
    if (salida.length >= MAX_IMAGENES_OFRECIDAS) break;
  }
  return salida;
}

/** "Talle: M / Color: Rojo", de los atributos de una variación. */
function nombreDeVariacion(variacion: Json, indice: number): string {
  const partes = arreglo(campo(variacion, 'attribute_combinations'))
    .filter(esObjeto)
    .map((atributo) => {
      const nombre = texto(campo(atributo, 'name'));
      const valor = texto(campo(atributo, 'value_name'));
      return nombre && valor ? `${nombre}: ${valor}` : valor;
    })
    .filter(Boolean);
  return textoSeguro(partes.join(' / '), { largo: LARGOS.variante, sinMontos: true }) || `Variante ${indice + 1}`;
}

/** Un item de `GET /items/{id}` (y su descripción en texto plano, si se pudo leer) → producto. */
export function productoDesdeItem(item: unknown, descripcionPlana: string | null): ProductoExtraido | null {
  if (!esObjeto(item)) return null;
  const id = texto(campo(item, 'id'));
  const nombre = textoSeguro(campo(item, 'title'), { largo: LARGOS.nombre, sinMontos: true });
  if (!/^M[A-Z]{2}\d{6,15}$/.test(id) || nombre.length < 2) return null;

  const avisos = new Set<AvisoBorrador>();
  const monedaCruda = texto(campo(item, 'currency_id')).toUpperCase();
  const moneda: Moneda | null = esMoneda(monedaCruda) ? monedaCruda : null;
  if (!monedaCruda) avisos.add('sin_moneda');
  else if (!moneda) avisos.add('moneda_no_soportada');
  const precio = (valor: unknown) => (moneda ? centavos(valor) : null);

  const variaciones = arreglo(campo(item, 'variations')).filter(esObjeto);
  let variantes: VarianteExtraida[] =
    variaciones.length > 0
      ? variaciones.map((variacion, indice) => ({
          nombre: nombreDeVariacion(variacion, indice),
          sku: skuDe(variacion),
          precioCentavos: precio(campo(variacion, 'price') ?? campo(item, 'price')),
        }))
      : [{ nombre: '', sku: skuDe(item), precioCentavos: precio(campo(item, 'price')) }];
  if (variantes.length > MAX_VARIANTES) {
    variantes = variantes.slice(0, MAX_VARIANTES);
    avisos.add('variantes_recortadas');
  }
  // SKUs repetidos (pasa) no sirven para distinguir: se dejan vacíos y el catálogo arma unos.
  const repetidos = new Set(
    variantes.map((variante) => variante.sku?.toLowerCase()).filter((sku, indice, todos) => sku && todos.indexOf(sku) !== indice),
  );
  variantes = variantes.map((variante) => (variante.sku && repetidos.has(variante.sku.toLowerCase()) ? { ...variante, sku: null } : variante));
  if (variantes.some((variante) => variante.precioCentavos === null)) avisos.add('sin_precio');

  const descripcion = textoSeguro(descripcionPlana ?? '', { largo: LARGOS.descripcion, multilinea: true, sinMontos: true });
  if (!descripcion) avisos.add('sin_descripcion');
  else if ((descripcionPlana ?? '').length > LARGOS.descripcion) avisos.add('descripcion_recortada');

  const imagenes = imagenesDe(item);
  if (imagenes.length === 0) avisos.add('sin_imagen');

  const permalink = texto(campo(item, 'permalink'));
  const revisada = permalink ? revisarUrl(permalink) : null;
  return {
    nombre,
    descripcion,
    categoria: null,
    moneda,
    variantes,
    imagenes,
    avisos: [...avisos],
    idExterno: id,
    url: revisada && 'url' in revisada ? revisada.url.href : null,
  };
}

/** `GET /items/{id}/description` → el texto plano, o null. */
export function descripcionDesde(respuesta: unknown): string | null {
  if (!esObjeto(respuesta)) return null;
  const plano = texto(campo(respuesta, 'plain_text'));
  return plano || null;
}

/** `GET /products/{id}` (ficha de catálogo) → la publicación que la vende (buy box), si hay. */
export function itemDeCatalogo(respuesta: unknown): string | null {
  if (!esObjeto(respuesta)) return null;
  const ganador = campo(respuesta, 'buy_box_winner');
  const id = esObjeto(ganador) ? texto(campo(ganador, 'item_id')) : '';
  return /^M[A-Z]{2}\d{6,15}$/.test(id) ? id : null;
}

/** `GET /sites/{sitio}/search` → los ids de las publicaciones y cuántas hay en total. */
export function idsDeBusqueda(respuesta: unknown, limite: number): { ids: string[]; total: number } {
  if (!esObjeto(respuesta)) return { ids: [], total: 0 };
  const ids = arreglo(campo(respuesta, 'results'))
    .filter(esObjeto)
    .map((resultado) => texto(campo(resultado, 'id')))
    .filter((id) => /^M[A-Z]{2}\d{6,15}$/.test(id));
  const paginado = campo(respuesta, 'paging');
  const total = esObjeto(paginado) && typeof campo(paginado, 'total') === 'number' ? Number(campo(paginado, 'total')) : ids.length;
  return { ids: [...new Set(ids)].slice(0, limite), total };
}

/**
 * La página de una tienda (/tienda/…) → los ids de las publicaciones que
 * enlaza, en orden y sin repetir. Es el camino cuando la búsqueda de la API
 * no responde: la página lista los destacados, no el catálogo entero. Se
 * leen del item_id / wid de los enlaces ("…/up/MLAU…?pdp_filters=item_id:MLA…")
 * y de las rutas "/MLA-123…"; sólo los del sitio de la tienda.
 */
export function idsDePaginaDeTienda(html: string, sitio: string, limite: number): { ids: string[]; total: number } {
  const vistos = new Set<string>();
  // Patrones sin cuantificadores anidados: lineales aunque la página sea enorme.
  const patron = /(?:item_id(?::|%3A|%253A)|wid=|\/)(M[A-Z]{2})-?(\d{6,15})\b/gi;
  for (const encontrado of html.matchAll(patron)) {
    const prefijo = encontrado[1].toUpperCase();
    if (prefijo !== sitio) continue;
    vistos.add(`${prefijo}${encontrado[2]}`);
  }
  const ids = [...vistos];
  return { ids: ids.slice(0, limite), total: ids.length };
}

/**
 * `GET /items?ids=…` (multiget) → los items que vinieron bien, y cuántos
 * rechazó: el multiget responde 200 aunque cada publicación venga con su 403
 * (Mercado Libre no deja leer las de otro vendedor con el token de la app).
 */
export function itemsDeMultiget(respuesta: unknown): { items: unknown[]; denegados: number } {
  const entradas = arreglo(respuesta).filter(esObjeto);
  return {
    items: entradas.filter((entrada) => campo(entrada, 'code') === 200).map((entrada) => campo(entrada, 'body')),
    denegados: entradas.filter((entrada) => campo(entrada, 'code') === 401 || campo(entrada, 'code') === 403).length,
  };
}

/** "999796 pesos argentinos con 50 centavos" (el aria-label del precio) → centavos y moneda. */
function precioDeTarjeta(etiqueta: string): { centavos: number | null; moneda: Moneda | null; monedaCruda: boolean } {
  const leido = /(\d{1,12}) (pesos argentinos|d[oó]lares(?: estadounidenses)?|[a-záéíóú]+(?: [a-záéíóú]+)?)(?: con (\d{1,2}) centavos?)?$/i.exec(etiqueta);
  if (!leido) return { centavos: null, moneda: null, monedaCruda: false };
  const nombre = leido[2].toLowerCase();
  const moneda: Moneda | null = nombre === 'pesos argentinos' ? 'ARS' : /^d[oó]lares/.test(nombre) ? 'USD' : null;
  const total = Number(leido[1]) + Number(leido[3] ?? 0) / 100;
  return { centavos: moneda ? centavos(total) : null, moneda, monedaCruda: true };
}

/**
 * Las tarjetas ("poly-card") de la página de una tienda → un producto por
 * publicación, con lo que muestra la tarjeta: nombre, precio actual, foto y
 * enlace. Es el camino cuando la API no deja leer las publicaciones: sin
 * descripción ni variantes, que el dueño completa en la vista previa. El
 * precio es el que muestra la tienda, no lo calcula nadie.
 */
export function productosDeTarjetas(html: string, sitio: string, limite: number): ProductoExtraido[] {
  const productos = new Map<string, ProductoExtraido>();
  // Cada tarjeta empieza por su foto ("portada") y sigue con el título y el precio.
  for (const entera of html.split('class="poly-card__portada"').slice(1)) {
    if (productos.size >= limite) break;
    // Una tarjeta real ocupa unos pocos KB: el tope deja las regex chicas aunque la página no tenga más tarjetas.
    const tarjeta = entera.slice(0, 8192);
    const enlace = /<a href="([^"]{1,2048})"[^>]{0,500}class="poly-component__title"[^>]{0,200}>([^<]{1,500})<\/a>/.exec(tarjeta);
    if (!enlace) continue;
    const href = decodificarEntidades(enlace[1]);
    const id = /(?:item_id(?::|%3A|%253A)|wid=|\/)(M[A-Z]{2})-?(\d{6,15})\b/i.exec(href);
    if (!id || id[1].toUpperCase() !== sitio) continue;
    const idExterno = `${sitio}${id[2]}`;
    const nombre = textoSeguro(enlace[2], { largo: LARGOS.nombre, sinMontos: true });
    if (productos.has(idExterno) || nombre.length < 2) continue;

    const avisos = new Set<AvisoBorrador>(['sin_descripcion']);
    // El precio se busca después del título: un título no puede hacerse pasar por precio.
    const actual = tarjeta.indexOf('poly-price__current', enlace.index + enlace[0].length);
    const etiqueta = actual >= 0 ? /aria-label="(?:[^":]{1,20}: )?([^"]{1,120})"/.exec(tarjeta.slice(actual, actual + 2000)) : null;
    const precio = etiqueta ? precioDeTarjeta(etiqueta[1]) : { centavos: null, moneda: null, monedaCruda: false };
    if (!precio.monedaCruda) avisos.add('sin_moneda');
    else if (!precio.moneda) avisos.add('moneda_no_soportada');
    if (precio.centavos === null) avisos.add('sin_precio');

    const foto = /<img class="poly-component__picture"[^>]{0,200} src="([^"]{1,2048})"/.exec(tarjeta)?.[1];
    const fotoRevisada = foto ? revisarUrl(decodificarEntidades(foto)) : null;
    const imagenes = fotoRevisada && 'url' in fotoRevisada ? [fotoRevisada.url.href] : [];
    if (imagenes.length === 0) avisos.add('sin_imagen');

    const revisada = revisarUrl(href);
    const url = 'url' in revisada ? revisada.url : null;
    if (url) url.hash = '';
    productos.set(idExterno, {
      nombre,
      descripcion: '',
      categoria: null,
      moneda: precio.moneda,
      variantes: [{ nombre: '', sku: null, precioCentavos: precio.centavos }],
      imagenes,
      avisos: [...avisos],
      idExterno,
      url: url?.href ?? null,
    });
  }
  return [...productos.values()];
}
