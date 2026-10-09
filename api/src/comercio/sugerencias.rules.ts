/**
 * Reglas de `ver_catalogo`, el "¿qué tenés?" del asistente de ventas. Todo
 * puro (sin base ni red), como catalogo.rules.ts: qué se muestra según cuántos
 * productos con stock hay, cómo se ordena lo que devuelve Jev y qué parte de
 * la charla le llega.
 *
 * - Hasta MAX_PRODUCTOS_LISTADO productos con stock: la lista entera.
 * - Más: hasta MAX_CATEGORIAS_SUGERIDAS categorías, las que Jev considera que
 *   más le pueden interesar al cliente, y un aviso de que hay otras.
 * - Con una categoría elegida: todos sus productos con stock.
 * - Más de MAX_PRODUCTOS_LISTADO sin ninguna categoría cargada: Jev elige
 *   MAX_PRODUCTOS_LISTADO y se avisa que hay más.
 */
import { normalizarTexto } from './catalogo.rules.js';

/** Hasta cuántos productos con stock se listan enteros. */
export const MAX_PRODUCTOS_LISTADO = 10;

/** Categorías que se le sugieren al cliente cuando el catálogo es grande. */
export const MAX_CATEGORIAS_SUGERIDAS = 5;

/** Una pregunta `choice` de Jev admite 255 opciones, y una es la `none` obligatoria. */
export const MAX_OPCIONES_DECISION = 254;

/** Dónde caen los productos sin categoría cuando el catálogo tiene otras. */
export const CATEGORIA_OTROS = 'Otros';

/** Mensajes del cliente que se le pasan a Jev, y su largo máximo total. */
export const MENSAJES_PARA_DECIDIR = 6;
export const LARGO_MAX_ESTADO = 1500;

export type ProductoPanorama = {
  productoId: string;
  nombre: string;
  categoria: string | null;
  descripcion: string;
  /** Precio final (con descuento, si hay) de la variante más barata con stock. */
  precioDesdeCentavos: number;
  /** true si las variantes con stock no cuestan todas lo mismo ("desde $X"). */
  variosPrecios: boolean;
  /** "20% off", si esa variante más barata tiene un descuento vigente. */
  descuento?: string | null;
};

export type CategoriaPanorama = { nombre: string; cantidad: number };

export type ResultadoCatalogo =
  | { tipo: 'vacio' }
  | { tipo: 'listado'; productos: ProductoPanorama[]; categoria: string | null; restantes: number }
  | { tipo: 'categorias'; categorias: CategoriaPanorama[]; restantes: number; totalProductos: number }
  | { tipo: 'categoria_sin_productos'; categoria: string; categorias: CategoriaPanorama[]; restantes: number };

/** El nombre de categoría con el que se muestra un producto (null sin categorías en el catálogo). */
export function categoriaVisible(producto: Pick<ProductoPanorama, 'categoria'>): string {
  return producto.categoria?.trim() || CATEGORIA_OTROS;
}

/**
 * Categorías con productos con stock, de la que más tiene a la que menos (y
 * por nombre a igual cantidad: el orden es determinista). Los productos sin
 * categoría cuentan como CATEGORIA_OTROS sólo si hay alguna otra categoría.
 */
export function agruparPorCategoria(productos: ProductoPanorama[]): CategoriaPanorama[] {
  if (!productos.some((producto) => producto.categoria?.trim())) return [];
  const cantidades = new Map<string, CategoriaPanorama>();
  for (const producto of productos) {
    const nombre = categoriaVisible(producto);
    const clave = normalizarTexto(nombre);
    const actual = cantidades.get(clave);
    if (actual) actual.cantidad += 1;
    else cantidades.set(clave, { nombre, cantidad: 1 });
  }
  return [...cantidades.values()].sort(
    (a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** Los productos de una categoría, comparando sin tildes ni mayúsculas ("remeras" = "Remeras"). */
export function productosDeCategoria(productos: ProductoPanorama[], categoria: string): ProductoPanorama[] {
  const buscada = normalizarTexto(categoria);
  const hayCategorias = productos.some((producto) => producto.categoria?.trim());
  return productos.filter((producto) => {
    if (producto.categoria?.trim()) return normalizarTexto(producto.categoria) === buscada;
    return hayCategorias && buscada === normalizarTexto(CATEGORIA_OTROS);
  });
}

/**
 * Reordena `ids` según las probabilidades de Jev, de mayor a menor. Lo que
 * Jev no puntuó queda al final en su orden original, y a igual probabilidad
 * también manda el orden original (el determinista).
 */
export function ordenarPorProbabilidad(ids: string[], probabilidades: Record<string, number>): string[] {
  const valor = (id: string) => {
    const probabilidad = probabilidades[id];
    return typeof probabilidad === 'number' && Number.isFinite(probabilidad) ? probabilidad : -1;
  };
  return ids
    .map((id, indice) => ({ id, indice }))
    .sort((a, b) => valor(b.id) - valor(a.id) || a.indice - b.indice)
    .map(({ id }) => id);
}

/**
 * Lo que Jev lee de la charla: sólo los últimos mensajes del cliente, en
 * texto, sin número ni nombre. Si se pasa del largo, se queda con lo más
 * reciente, que es lo que mejor dice qué busca ahora.
 */
export function estadoParaDecidir(mensajesDelCliente: string[]): string {
  const texto = mensajesDelCliente
    .map((mensaje) => mensaje.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-MENSAJES_PARA_DECIDIR)
    .join('\n');
  return texto.length > LARGO_MAX_ESTADO ? texto.slice(texto.length - LARGO_MAX_ESTADO) : texto;
}
