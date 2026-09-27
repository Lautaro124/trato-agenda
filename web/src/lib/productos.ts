import { apiFetch } from "./api";

/** Espejo de `VariantePublica` en la API. Precio en centavos, como lo guarda la base. */
export type Variante = {
  id: string;
  sku: string;
  nombre: string;
  precioCentavos: number;
  /** null = el dueño no controla cantidad y vale `disponible`. */
  stock: number | null;
  disponible: boolean;
  stockMinimo: number | null;
  activo: boolean;
};

/** Espejo de `ProductoPublico` en la API. */
export type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  activo: boolean;
  updatedAt: string;
  /** true cuando el asistente ya lo encuentra también por significado. */
  indexado: boolean;
  variantes: Variante[];
};

export type ListadoProductos = { productos: Producto[]; total: number; pagina: number; porPagina: number };

export type Categoria = { nombre: string; cantidad: number };

export type ResumenImportacion = {
  nuevos: number;
  actualizados: number;
  variantes: number;
  errores: Array<{ fila: number; mensaje: string }>;
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
  variantes: Array<{
    varianteId: string;
    sku: string;
    nombre: string;
    precioCentavos: number;
    hayStock: boolean;
    stock: string;
  }>;
};

/** Body de alta/edición: el mismo shape que `GuardarProductoDto`. */
export type ProductoAGuardar = {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  variantes: Array<{
    sku?: string;
    nombre: string;
    precioCentavos: number;
    stock: number | null;
    disponible: boolean;
    stockMinimo: number | null;
  }>;
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

export function actualizarVariante(
  id: string,
  cambios: Partial<Pick<Variante, "precioCentavos" | "stock" | "disponible" | "stockMinimo">>,
) {
  return apiFetch(`/productos/variantes/${id}`, {
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
  const pesos = centavos / 100;
  return `$ ${Number.isInteger(pesos) ? PESOS.format(pesos) : PESOS_CON_CENTAVOS.format(pesos)}`;
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

/** "Sin stock", "Quedan 2", "12 u." o "Hay" — para la tabla del dueño, que sí ve cantidades. */
export function etiquetaStock(variante: Pick<Variante, "stock" | "disponible" | "stockMinimo">): {
  texto: string;
  tono: "success" | "warning" | "danger";
} {
  if (variante.stock === null) {
    return variante.disponible ? { texto: "Hay", tono: "success" } : { texto: "Sin stock", tono: "danger" };
  }
  if (variante.stock === 0) return { texto: "Sin stock", tono: "danger" };
  const bajo = variante.stockMinimo !== null && variante.stock <= variante.stockMinimo;
  return { texto: `${variante.stock} u.`, tono: bajo ? "warning" : "success" };
}
