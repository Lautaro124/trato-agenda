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
import { textoSeguro } from './texto.rules.js';
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
  return textoSeguro(crudo, { largo: LARGOS.sku }) || null;
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
  return textoSeguro(partes.join(' / '), { largo: LARGOS.variante }) || `Variante ${indice + 1}`;
}

/** Un item de `GET /items/{id}` (y su descripción en texto plano, si se pudo leer) → producto. */
export function productoDesdeItem(item: unknown, descripcionPlana: string | null): ProductoExtraido | null {
  if (!esObjeto(item)) return null;
  const id = texto(campo(item, 'id'));
  const nombre = textoSeguro(campo(item, 'title'), { largo: LARGOS.nombre });
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

/** `GET /items?ids=…` (multiget) → los items que vinieron bien. */
export function itemsDeMultiget(respuesta: unknown): unknown[] {
  return arreglo(respuesta)
    .filter(esObjeto)
    .filter((entrada) => campo(entrada, 'code') === 200)
    .map((entrada) => campo(entrada, 'body'));
}
