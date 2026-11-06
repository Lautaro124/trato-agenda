import type { CuotasProducto } from "./condiciones-pago";

/** Espejo de `PreguntaProducto` en la API (comercio/preguntas-producto.rules.ts). */
export type PreguntaProducto = {
  texto: string;
  tipo: "opciones" | "texto";
  /** Vacío en las de texto libre. */
  opciones: string[];
  obligatoria: boolean;
};

export const MAX_PREGUNTAS = 5;
export const MIN_OPCIONES = 2;
export const MAX_OPCIONES = 12;
export const LARGO_PREGUNTA = 120;
export const LARGO_OPCION = 40;
import { apiFetch } from "./api";
import type { Descuento, DescuentoAGuardar, DescuentoDeProducto } from "./descuentos";

/** Espejo de `ProductoPublico` en la API. */
export type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  /** La moneda de su precio. */
  moneda: Moneda;
  activo: boolean;
  updatedAt: string;
  /** Precio en centavos, como lo guarda la base. */
  precioCentavos: number;
  /** null = a demanda: no se controla cantidad y vale `disponible`. */
  stock: number | null;
  disponible: boolean;
  stockMinimo: number | null;
  /** A demanda: en cuántos días se entrega (null con stock o si no se cargó). */
  plazoEntregaDias: number | null;
  /** Lo que paga hoy el cliente, con el mejor descuento vigente. */
  precioFinalCentavos: number;
  /** El descuento que hoy le toca (el propio o una promo). */
  descuentoAplicado: DescuentoDeProducto | null;
  /** true cuando el asistente ya lo encuentra también por significado. */
  indexado: boolean;
  /** El descuento propio del producto (vigente o no). */
  descuento: Descuento | null;
  /** Cuándo se subió la foto principal; null = sin fotos. */
  imagenActualizada: string | null;
  /** Todas las fotos, la principal primero. */
  imagenes: FotoDeProducto[];
  /** Las cuotas del producto; null = en un pago. */
  cuotas: CuotasProducto | null;
  /** Lo que el asistente le pregunta al cliente al pedirlo; null = nada. */
  preguntas: PreguntaProducto[] | null;
};

/** Una foto del producto (sin los bytes): `actualizada` evita mostrar una cacheada vieja. */
export type FotoDeProducto = { id: string; actualizada: string };

export type ListadoProductos = { productos: Producto[]; total: number; pagina: number; porPagina: number };

export type Categoria = { nombre: string; cantidad: number };

/** `columna` (la de la plantilla) está sólo si el error se arregla corrigiendo un campo de esa fila. */
export type ErrorDeFila = { fila: number; mensaje: string; columna?: string };

export type ResumenImportacion = {
  nuevos: number;
  actualizados: number;
  errores: ErrorDeFila[];
  totalErrores: number;
  confirmado: boolean;
};

/** Lo que devuelve la búsqueda del asistente (`BusquedaService`). */
export type ProductoEncontrado = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  descripcion: string;
  /** Ausente = pesos. */
  moneda?: Moneda;
  precioCentavos: number;
  precioFinalCentavos: number;
  descuento: DescuentoDeProducto | null;
  hayStock: boolean;
  stock: string;
};

/** Body de alta/edición (`GuardarProductoDto`). */
export type ProductoAGuardar = {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  moneda: Moneda;
  precioCentavos: number;
  stock: number | null;
  disponible: boolean;
  stockMinimo: number | null;
  /** A demanda: días de entrega; con stock va null. */
  plazoEntregaDias: number | null;
  /** null lo borra. */
  descuento: DescuentoAGuardar | null;
  /** null = en un pago. */
  cuotas: CuotasProducto | null;
  /** null = no pregunta nada. */
  preguntas: PreguntaProducto[] | null;
};

/** Error de la API con el mensaje que ya viene en español (409, 400). */
export class ErrorDeApi extends Error {}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function listarProductos(filtros: { q?: string; categoria?: string; pagina?: number }) {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.categoria) params.set("categoria", filtros.categoria);
  if (filtros.pagina && filtros.pagina > 1) params.set("pagina", String(filtros.pagina));
  const query = params.toString();
  return apiFetch(`/productos${query ? `?${query}` : ""}`).then((res) => json<ListadoProductos>(res));
}

/** Un producto para su pantalla de edición; 404 si no es de la cuenta. */
export function obtenerProducto(id: string) {
  return apiFetch(`/productos/${encodeURIComponent(id)}`).then((res) => json<Producto>(res));
}

export function listarCategorias() {
  return apiFetch("/productos/categorias").then((res) => json<Categoria[]>(res));
}

export function buscarComoElAsistente(q: string) {
  return apiFetch(`/productos/buscar?${new URLSearchParams({ q })}`).then((res) => json<ProductoEncontrado[]>(res));
}

export function guardarProducto(producto: ProductoAGuardar, id?: string) {
  return apiFetch(id ? `/productos/${id}` : "/productos", {
    method: id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(producto),
  }).then((res) => json<Producto>(res));
}

/** La edición rápida de precio y stock desde la tarjeta del catálogo. */
export function actualizarStock(
  id: string,
  cambios: Partial<Pick<Producto, "precioCentavos" | "stock" | "disponible" | "stockMinimo">>,
) {
  return apiFetch(`/productos/${encodeURIComponent(id)}/stock`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(cambios),
  }).then((res) => json<Producto>(res));
}

export function eliminarProducto(id: string) {
  return apiFetch(`/productos/${id}`, { method: "DELETE" }).then((res) => json<void>(res));
}

export function importarProductos(filas: Array<Record<string, string>>, confirmar: boolean) {
  return apiFetch("/productos/importar", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ filas, confirmar }),
  }).then((res) => json<ResumenImportacion>(res));
}

// --- Precios en centavos ------------------------------------------------------

const PESOS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const PESOS_CON_CENTAVOS = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 150000 → "$ 1.500"; 150050 → "$ 1.500,50". */
export function formatearCentavos(centavos: number): string {
  return formatearMonto(centavos, "ARS");
}

/** Monedas de un producto (las de MONEDAS en la API): todo lo demás es en pesos. */
export const MONEDAS = ["ARS", "USD"] as const;
export type Moneda = (typeof MONEDAS)[number];

export const NOMBRE_MONEDA: Record<Moneda, string> = { ARS: "Pesos", USD: "Dólares" };

/** 150000 en pesos → "$ 1.500"; en dólares → "US$ 1.500". El mismo formato que la API. */
export function formatearMonto(centavos: number, moneda: string = "ARS"): string {
  const unidades = centavos / 100;
  const numero = Number.isInteger(unidades) ? PESOS.format(unidades) : PESOS_CON_CENTAVOS.format(unidades);
  return `${moneda === "USD" ? "US$" : "$"} ${numero}`;
}

/** Tope del precio, el mismo que PRECIO_MAX_PESOS de la API. */
export const PRECIO_MAX_PESOS = 100_000_000;

/**
 * Lo que se tipeó en un campo de precio → centavos. Acepta "1500", "1.500" y
 * "1.500,50" (la coma es siempre el decimal en el formulario). null si no es
 * un precio válido.
 */
export function leerCentavos(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "");
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(limpio)) return null;
  const centavos = Math.round(Number(limpio.replace(/\./g, "").replace(",", ".")) * 100);
  return centavos <= PRECIO_MAX_PESOS * 100 ? centavos : null;
}

/** Valor inicial del input: "1.500" o "1.500,50", sin el "$". */
export function centavosParaInput(centavos: number): string {
  return formatearCentavos(centavos).replace(/^\$ /, "");
}

/** "1 unidad", "12 unidades": el texto entero, sin abreviar. */
export function unidades(cantidad: number): string {
  return cantidad === 1 ? "1 unidad" : `${cantidad} unidades`;
}

/** Plazo de entrega máximo de un producto a demanda, en días (el mismo de la API, catalogo.rules.ts). */
export const PLAZO_ENTREGA_MAX_DIAS = 365;

/** "Sin stock", "Stock bajo", "12 unidades" o "A demanda" — para la tabla del dueño, que sí ve cantidades. */
export function etiquetaStock(producto: Pick<Producto, "stock" | "disponible" | "stockMinimo">): {
  texto: string;
  tono: "success" | "warning" | "danger";
} {
  if (producto.stock === null) {
    return producto.disponible ? { texto: "A demanda", tono: "success" } : { texto: "Sin stock", tono: "danger" };
  }
  if (producto.stock === 0) return { texto: "Sin stock", tono: "danger" };
  const bajo = producto.stockMinimo !== null && producto.stock <= producto.stockMinimo;
  return bajo ? { texto: "Stock bajo", tono: "warning" } : { texto: unidades(producto.stock), tono: "success" };
}
