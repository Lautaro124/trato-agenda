/**
 * De los bloques JSON-LD (schema.org) y de las etiquetas <meta> de una página
 * a un producto del catálogo. Es lo que publican la mayoría de las tiendas
 * (Tiendanube, Shopify, WooCommerce, VTEX, Tiendamia) para que Google muestre
 * precio y stock, así que alcanza para leerlas sin un navegador.
 *
 * Todo lo que sale de acá es de la página, no del dueño: pasa por textoSeguro
 * y los precios se leen como en la planilla (parsearPrecio). Si algo falta,
 * queda vacío con un aviso; nunca se completa.
 */
import { LARGOS, MAX_VARIANTES, parsearPrecio, PRECIO_MAX_PESOS, esMoneda, type Moneda } from '../comercio/catalogo.rules.js';
import { revisarUrl } from './ssrf.rules.js';
import { textoSeguro } from './texto.rules.js';
import {
  MAX_IMAGENES_OFRECIDAS,
  MAX_PRODUCTOS_LISTADO_WEB,
  type AvisoBorrador,
  type ProductoExtraido,
  type VarianteExtraida,
} from './modelo.js';

/** Nodos que se recorren por página y hasta qué profundidad: un JSON armado para colgar el proceso no pasa de acá. */
const MAX_NODOS = 5000;
const MAX_PROFUNDIDAD = 12;

type Nodo = Record<string, unknown>;

export type ResultadoPagina =
  | { tipo: 'producto'; producto: ProductoExtraido }
  | { tipo: 'listado'; urls: string[]; recortado: boolean }
  | { tipo: 'nada' };

const esObjeto = (valor: unknown): valor is Nodo => typeof valor === 'object' && valor !== null && !Array.isArray(valor);

function campo(nodo: Nodo, clave: string): unknown {
  return Object.hasOwn(nodo, clave) ? nodo[clave] : undefined;
}

function lista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function tipos(nodo: Nodo): string[] {
  return lista(campo(nodo, '@type'))
    .filter((tipo): tipo is string => typeof tipo === 'string')
    .map((tipo) => tipo.toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
}

/** Todos los objetos de los bloques, recorridos a lo ancho con tope de nodos y de profundidad. */
function nodosDe(bloques: string[]): Nodo[] {
  const salida: Nodo[] = [];
  const pendientes: Array<{ valor: unknown; profundidad: number }> = [];
  for (const bloque of bloques) {
    try {
      pendientes.push({ valor: JSON.parse(bloque) as unknown, profundidad: 0 });
    } catch {
      // Un bloque roto (pasa) no tira la página entera.
    }
  }
  // Una cola con índice (no shift, que es lineal) y con tope: un arreglo de un millón de elementos no entra entero.
  const encolar = (valor: unknown, profundidad: number) => {
    if (typeof valor === 'object' && valor !== null && pendientes.length < MAX_NODOS) pendientes.push({ valor, profundidad });
  };
  for (let i = 0; i < pendientes.length; i++) {
    const { valor, profundidad } = pendientes[i];
    if (profundidad > MAX_PROFUNDIDAD) continue;
    if (Array.isArray(valor)) {
      for (const hijo of valor) encolar(hijo, profundidad + 1);
    } else if (esObjeto(valor)) {
      salida.push(valor);
      for (const clave of Object.keys(valor)) encolar(valor[clave], profundidad + 1);
    }
  }
  return salida;
}

/** Un precio de JSON-LD (número o texto) → centavos, o null si no es un precio válido. */
export function precioDe(valor: unknown): number | null {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0 || valor > PRECIO_MAX_PESOS) return null;
    return Math.round(valor * 100);
  }
  if (typeof valor === 'string' && valor.trim()) return parsearPrecio(valor.trim().slice(0, 40));
  return null;
}

type Oferta = { precioCentavos: number | null; moneda: string | null };

function ofertasDe(nodo: Nodo): Oferta[] {
  const salida: Oferta[] = [];
  for (const oferta of lista(campo(nodo, 'offers'))) {
    if (!esObjeto(oferta)) continue;
    const especificacion = lista(campo(oferta, 'priceSpecification')).find(esObjeto);
    const precio =
      precioDe(campo(oferta, 'price')) ??
      precioDe(campo(oferta, 'lowPrice')) ??
      (especificacion ? precioDe(campo(especificacion, 'price')) : null);
    const moneda = campo(oferta, 'priceCurrency') ?? (especificacion ? campo(especificacion, 'priceCurrency') : undefined);
    salida.push({ precioCentavos: precio, moneda: typeof moneda === 'string' ? moneda.trim().toUpperCase() : null });
    // Un AggregateOffer puede traer las ofertas sueltas adentro.
    for (const interna of lista(campo(oferta, 'offers')).filter(esObjeto)) {
      salida.push({
        precioCentavos: precioDe(campo(interna, 'price')),
        moneda: typeof campo(interna, 'priceCurrency') === 'string' ? String(campo(interna, 'priceCurrency')).toUpperCase() : null,
      });
    }
  }
  return salida;
}

/** La oferta más barata con precio, o la primera si ninguna lo tiene. */
function mejorOferta(ofertas: Oferta[]): Oferta | null {
  const conPrecio = ofertas.filter((oferta) => oferta.precioCentavos !== null);
  if (conPrecio.length === 0) return ofertas[0] ?? null;
  return conPrecio.reduce((mejor, oferta) => ((oferta.precioCentavos as number) < (mejor.precioCentavos as number) ? oferta : mejor), conPrecio[0]);
}

/** Una URL de imagen o de producto relativa a la página → absoluta, sólo si se la podría pedir. */
export function urlUtil(valor: unknown, base: URL, hostsDePrueba?: ReadonlySet<string>): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  let absoluta: string;
  try {
    absoluta = new URL(valor.trim(), base).href;
  } catch {
    return null;
  }
  const revisada = revisarUrl(absoluta, hostsDePrueba);
  return 'url' in revisada ? revisada.url.href : null;
}

function imagenesDe(nodo: Nodo, base: URL, hostsDePrueba?: ReadonlySet<string>): string[] {
  const salida: string[] = [];
  for (const imagen of lista(campo(nodo, 'image'))) {
    const url = urlUtil(esObjeto(imagen) ? (campo(imagen, 'url') ?? campo(imagen, 'contentUrl')) : imagen, base, hostsDePrueba);
    if (url && !salida.includes(url)) salida.push(url);
    if (salida.length >= MAX_IMAGENES_OFRECIDAS) break;
  }
  return salida;
}

function textoDeCampo(nodo: Nodo, clave: string): string {
  const valor = campo(nodo, clave);
  if (esObjeto(valor)) return typeof campo(valor, 'name') === 'string' ? String(campo(valor, 'name')) : '';
  return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '';
}

/** "Hogar > Cocina > Mates" → "Mates": la categoría más específica. */
function categoriaDe(nodo: Nodo): string | null {
  const crudo = textoDeCampo(nodo, 'category');
  const ultima = crudo.split(/[>/|]/).map((parte) => parte.trim()).filter(Boolean).at(-1) ?? '';
  return textoSeguro(ultima, { largo: LARGOS.categoria, sinMontos: true }) || null;
}

/** El nombre de una variante sin repetir el del producto: "Remera básica - Talle M" → "Talle M". */
function nombreDeVariante(crudo: string, delGrupo: string): string {
  // Acotado antes de mirarlo: viene de la página y puede ser enorme.
  const nombre = crudo.slice(0, LARGOS.nombre * 2);
  if (delGrupo && nombre.toLowerCase().startsWith(delGrupo.toLowerCase())) {
    const separadores = ' \t\n-–—,:|/()';
    let desde = delGrupo.length;
    let hasta = nombre.length;
    while (desde < hasta && separadores.includes(nombre[desde])) desde++;
    while (hasta > desde && ' \t\n)'.includes(nombre[hasta - 1])) hasta--;
    const resto = nombre.slice(desde, hasta);
    if (resto) return resto;
  }
  return nombre;
}

/**
 * La moneda de las ofertas: ARS o USD se venden; cualquier otra deja los
 * precios vacíos (no se convierte nada), y sin moneda el dueño la elige.
 */
function monedaDe(ofertas: Oferta[], avisos: Set<AvisoBorrador>): Moneda | null | 'otra' {
  const monedas = new Set(ofertas.map((oferta) => oferta.moneda).filter((moneda): moneda is string => Boolean(moneda)));
  if (monedas.size === 0) return null;
  const [primera] = monedas;
  if (monedas.size > 1 || !esMoneda(primera)) {
    avisos.add('moneda_no_soportada');
    return 'otra';
  }
  return primera;
}

function armarProducto(
  nodo: Nodo,
  variantesCrudas: Nodo[],
  base: URL,
  hostsDePrueba?: ReadonlySet<string>,
): ProductoExtraido | null {
  const avisos = new Set<AvisoBorrador>();
  const nombre = textoSeguro(textoDeCampo(nodo, 'name'), { largo: LARGOS.nombre, sinMontos: true });
  if (nombre.length < 2) return null;
  const descripcionCruda = textoDeCampo(nodo, 'description');
  const descripcion = textoSeguro(descripcionCruda, { largo: LARGOS.descripcion, multilinea: true, sinMontos: true });
  if (!descripcion) avisos.add('sin_descripcion');
  else if (descripcionCruda.length > LARGOS.descripcion) avisos.add('descripcion_recortada');

  // Cada variante con sus ofertas; un producto sin variantes es una variante única sin nombre.
  const fuentes = variantesCrudas.length > 0 ? variantesCrudas : [nodo];
  const porVariante = fuentes.map((fuente) => ({ fuente, oferta: mejorOferta(ofertasDe(fuente).concat(fuente === nodo ? [] : ofertasDe(nodo))) }));
  const moneda = monedaDe(
    porVariante.flatMap(({ oferta }) => (oferta ? [oferta] : [])),
    avisos,
  );

  const skus = new Set<string>();
  let variantes: VarianteExtraida[] = porVariante.map(({ fuente, oferta }) => {
    const sku = textoSeguro(textoDeCampo(fuente, 'sku') || textoDeCampo(fuente, 'mpn'), { largo: LARGOS.sku, sinMontos: true }) || null;
    const unico = sku && !skus.has(sku.toLowerCase()) ? sku : null;
    if (unico) skus.add(unico.toLowerCase());
    return {
      nombre:
        fuente === nodo ? '' : textoSeguro(nombreDeVariante(textoDeCampo(fuente, 'name'), nombre), { largo: LARGOS.variante, sinMontos: true }),
      sku: unico,
      precioCentavos: moneda === 'otra' ? null : (oferta?.precioCentavos ?? null),
    };
  });
  if (variantes.length > MAX_VARIANTES) {
    variantes = variantes.slice(0, MAX_VARIANTES);
    avisos.add('variantes_recortadas');
  }
  // Dos variantes con el mismo nombre (o sin nombre) no se distinguen: se numeran.
  if (variantes.length > 1) {
    const vistos = new Map<string, number>();
    variantes = variantes.map((variante, indice) => {
      const base = variante.nombre || `Variante ${indice + 1}`;
      const veces = (vistos.get(base.toLowerCase()) ?? 0) + 1;
      vistos.set(base.toLowerCase(), veces);
      return { ...variante, nombre: (veces > 1 ? `${base} (${veces})` : base).slice(0, LARGOS.variante) };
    });
  }
  if (variantes.some((variante) => variante.precioCentavos === null)) avisos.add('sin_precio');
  if (moneda === null) avisos.add('sin_moneda');

  const imagenes = [nodo, ...variantesCrudas].flatMap((fuente) => imagenesDe(fuente, base, hostsDePrueba));
  const unicas = [...new Set(imagenes)].slice(0, MAX_IMAGENES_OFRECIDAS);
  if (unicas.length === 0) avisos.add('sin_imagen');

  return {
    nombre,
    descripcion,
    categoria: categoriaDe(nodo),
    moneda: moneda === 'otra' ? null : moneda,
    variantes,
    imagenes: unicas,
    avisos: [...avisos],
    idExterno: null,
    url: urlUtil(campo(nodo, 'url'), base, hostsDePrueba),
  };
}

/** Las URLs de un ItemList, del mismo sitio que el listado: un listado no puede mandar a pedir a otros hosts. */
function urlsDeListado(listas: Nodo[], base: URL, hostsDePrueba?: ReadonlySet<string>): { urls: string[]; recortado: boolean } {
  const urls: string[] = [];
  let total = 0;
  for (const listaNodo of listas) {
    for (const elemento of lista(campo(listaNodo, 'itemListElement'))) {
      const item = esObjeto(elemento) ? (campo(elemento, 'item') ?? elemento) : elemento;
      const crudo = esObjeto(item) ? (campo(item, 'url') ?? campo(item, '@id')) : item;
      const url = urlUtil(crudo, base, hostsDePrueba);
      if (!url || new URL(url).hostname !== base.hostname || urls.includes(url)) continue;
      total++;
      if (urls.length < MAX_PRODUCTOS_LISTADO_WEB) urls.push(url);
    }
  }
  return { urls, recortado: total > urls.length };
}

/**
 * Qué hay en la página según su JSON-LD: un producto (con sus variantes si es
 * un ProductGroup), un listado (ItemList) o nada.
 */
export function leerJsonLd(bloques: string[], base: URL, hostsDePrueba?: ReadonlySet<string>): ResultadoPagina {
  const nodos = nodosDe(bloques);
  const grupos = nodos.filter((nodo) => tipos(nodo).includes('productgroup'));
  for (const grupo of grupos) {
    const variantes = lista(campo(grupo, 'hasVariant')).filter(esObjeto);
    const producto = armarProducto(grupo, variantes, base, hostsDePrueba);
    if (producto) return { tipo: 'producto', producto };
  }
  const productos = nodos.filter((nodo) => tipos(nodo).includes('product'));
  // El principal es el primero con ofertas (los relacionados suelen venir sin precio); si ninguno tiene, el primero.
  const principal = productos.find((nodo) => ofertasDe(nodo).length > 0) ?? productos[0];
  if (principal) {
    const producto = armarProducto(principal, [], base, hostsDePrueba);
    if (producto) return { tipo: 'producto', producto };
  }
  const listas = nodos.filter((nodo) => tipos(nodo).includes('itemlist'));
  if (listas.length > 0) {
    const { urls, recortado } = urlsDeListado(listas, base, hostsDePrueba);
    if (urls.length > 0) return { tipo: 'listado', urls, recortado };
  }
  return { tipo: 'nada' };
}

/**
 * Lo que dicen las <meta> de Open Graph y de producto, para las páginas sin
 * JSON-LD. Sólo cuenta como producto si dice un precio o se declara producto.
 */
export function leerMetas(metas: Map<string, string>, base: URL, hostsDePrueba?: ReadonlySet<string>): ProductoExtraido | null {
  const valor = (...claves: string[]) => claves.map((clave) => metas.get(clave)).find((encontrado) => encontrado?.trim()) ?? '';
  const precio = valor('product:price:amount', 'og:price:amount', 'price');
  const esProducto = valor('og:type').toLowerCase().includes('product') || Boolean(precio);
  if (!esProducto) return null;
  const nodo: Nodo = {
    name: valor('og:title', 'twitter:title'),
    description: valor('og:description', 'description', 'twitter:description'),
    image: valor('og:image:secure_url', 'og:image', 'twitter:image'),
    offers: { price: precio, priceCurrency: valor('product:price:currency', 'og:price:currency', 'pricecurrency') },
  };
  return armarProducto(nodo, [], base, hostsDePrueba);
}
