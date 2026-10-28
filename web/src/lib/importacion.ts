import { apiFetch } from "./api";
import { ErrorDeApi, leerCentavos, type Moneda } from "./productos";
import { LARGO_MAX_MATERIAL, MAX_MATERIALES } from "./solicitud";

/** Espejo de los topes de la API (importacion/modelo.ts). */
export const MAX_URLS_POR_PEDIDO = 10;
export const MAX_PRODUCTOS_POR_CONFIRMACION = 10;
/** Versiones con precio fijo de un producto a medida (como las variantes en la API). */
export const MAX_VERSIONES = 50;

export type FuenteImportacion = "mercadolibre" | "tiendamia" | "web";

export type AvisoBorrador =
  | "sin_precio"
  | "sin_moneda"
  | "moneda_no_soportada"
  | "variantes_recortadas"
  | "descripcion_recortada"
  | "sin_descripcion"
  | "sin_imagen"
  | "parece_a_medida";

/** Cómo se vende lo importado: de stock (precio fijo por variante) o a medida (se cotiza). */
export type TipoImportado = "stock" | "a_medida";

export type CodigoErrorImportacion =
  | "url_invalida"
  | "host_no_permitido"
  | "acceso_denegado"
  | "no_encontrada"
  | "error_del_sitio"
  | "tipo_no_soportado"
  | "demasiado_grande"
  | "tiempo_agotado"
  | "sin_conexion"
  | "pagina_no_soportada"
  | "sin_datos_de_producto"
  | "mercadolibre_no_disponible"
  | "listado_no_soportado";

/** Espejo de `BorradorProducto` en la API: lo que salió de una página, para revisar antes de guardar. */
export type BorradorProducto = {
  claveOrigen: string;
  origenUrl: string;
  fuente: FuenteImportacion;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  moneda: Moneda | null;
  variantes: Array<{ nombre: string; sku: string | null; precioCentavos: number | null }>;
  imagenes: string[];
  avisos: AvisoBorrador[];
  codigoSugerido: string;
  duplicado: { motivo: "origen" | "codigo" | "sku"; productoId: string; nombre: string } | null;
  /** Lo que sugiere la API según la página; null = sin precio ni pistas: lo elige el dueño. */
  tipoSugerido: TipoImportado | null;
  firma: string;
  emitidaAt: string;
};

export type ResultadoExtraccion = {
  productos: BorradorProducto[];
  errores: Array<{ url: string; codigo: CodigoErrorImportacion }>;
  recortado: boolean;
};

export type ResultadoConfirmacion = {
  resultados: Array<{
    claveOrigen: string;
    estado: "creado" | "actualizado" | "salteado" | "error";
    productoId?: string;
    tipo?: TipoImportado;
    motivo?: string;
    foto: "guardada" | "sin_foto" | "fallo" | "limite";
  }>;
};

/** Lo que el dueño ve y edita de cada producto: los precios como los tipea (texto). */
export type ProductoEnRevision = {
  borrador: BorradorProducto;
  elegido: boolean;
  /** Si ya existe: true lo pisa con estos datos, false lo saltea. */
  actualizar: boolean;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  moneda: Moneda | null;
  /** null hasta que el dueño elige: lo pregunta la tarjeta cuando la página no trae precio. */
  tipo: TipoImportado | null;
  /** De stock: cada variante con su precio. */
  variantes: Array<{ clave: string; nombre: string; sku: string; precio: string; stock: string }>;
  /** A medida: el precio "desde" (opcional), los materiales separados por coma y las versiones con precio fijo. */
  precioDesde: string;
  materiales: string;
  versiones: Array<{ clave: string; nombre: string; precio: string }>;
  /** Índice de la foto elegida en `borrador.imagenes`, o null para ninguna. */
  imagen: number | null;
};

const CENTAVOS_A_TEXTO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Un borrador → lo editable. Lo que ya está en el catálogo arranca destildado: importarlo es elegirlo. */
export function enRevision(borrador: BorradorProducto): ProductoEnRevision {
  return {
    borrador,
    elegido: borrador.duplicado === null,
    actualizar: false,
    codigo: borrador.codigoSugerido,
    nombre: borrador.nombre,
    descripcion: borrador.descripcion,
    categoria: borrador.categoria ?? "",
    moneda: borrador.moneda,
    tipo: borrador.tipoSugerido,
    variantes: borrador.variantes.map((variante, indice) => ({
      clave: `${indice}`,
      nombre: variante.nombre,
      sku: variante.sku ?? "",
      precio: variante.precioCentavos === null ? "" : CENTAVOS_A_TEXTO.format(variante.precioCentavos / 100),
      stock: "",
    })),
    precioDesde: "",
    materiales: "",
    // Si se carga a medida, las variantes con nombre y precio de la página pasan a ser versiones con precio fijo.
    versiones: borrador.variantes.flatMap((variante, indice) =>
      variante.nombre && variante.precioCentavos !== null
        ? [{ clave: `${indice}`, nombre: variante.nombre, precio: CENTAVOS_A_TEXTO.format(variante.precioCentavos / 100) }]
        : [],
    ),
    imagen: borrador.imagenes.length > 0 ? 0 : null,
  };
}

/** "Pana, chenille\nLino" → ["Pana", "chenille", "Lino"], sin repetir. */
export function materialesDe(texto: string): string[] {
  const vistos = new Set<string>();
  return texto
    .split(/[,\n]/)
    .map((material) => material.trim())
    .filter((material) => {
      const clave = material.toLowerCase();
      if (!material || vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

function entero(texto: string): number | null | "invalido" {
  const limpio = texto.trim();
  if (!limpio) return null;
  return /^\d{1,7}$/.test(limpio) ? Number(limpio) : "invalido";
}

/** Qué le falta a un producto para poder importarlo, o null. Nada se completa solo. */
export function problemaDelProducto(producto: ProductoEnRevision): string | null {
  if (!producto.codigo.trim()) return "Falta el código.";
  if (producto.nombre.trim().length < 2) return "Falta el nombre.";
  if (!producto.tipo) return "Elegí si es un producto a medida o de stock.";
  if (producto.tipo === "a_medida") return problemaAMedida(producto);
  if (!producto.moneda) return "Elegí si el precio es en pesos o en dólares.";
  if (producto.variantes.length > 1 && producto.variantes.some((variante) => !variante.nombre.trim())) {
    return "Poné el nombre de cada variante.";
  }
  for (const variante of producto.variantes) {
    if (!variante.precio.trim()) return producto.variantes.length > 1 ? `Falta el precio de ${variante.nombre}.` : "Falta el precio.";
    if (leerCentavos(variante.precio) === null) return "Revisá el precio.";
    if (entero(variante.stock) === "invalido") return "El stock tiene que ser un número entero (o vacío).";
  }
  return null;
}

/** Lo de un producto a medida: espejo de las reglas de la API (desdeDto y normalizarMateriales). */
function problemaAMedida(producto: ProductoEnRevision): string | null {
  if (producto.precioDesde.trim() && leerCentavos(producto.precioDesde) === null) return "Revisá el precio \"desde\".";
  const materiales = materialesDe(producto.materiales);
  if (materiales.length > MAX_MATERIALES) return `Poné hasta ${MAX_MATERIALES} materiales.`;
  if (materiales.some((material) => material.length > LARGO_MAX_MATERIAL)) {
    return `Cada material puede tener hasta ${LARGO_MAX_MATERIAL} caracteres.`;
  }
  for (const version of producto.versiones) {
    if (!version.nombre.trim()) return "Poné el nombre de cada versión con precio fijo.";
    if (!version.precio.trim()) return `Falta el precio de ${version.nombre.trim()}.`;
    if (leerCentavos(version.precio) === null) return `Revisá el precio de ${version.nombre.trim()}.`;
  }
  return null;
}

/** Lo editado → el item que acepta `POST /importacion/confirmar`. Sólo con `problemaDelProducto` en null. */
export function itemParaConfirmar(producto: ProductoEnRevision) {
  const { borrador } = producto;
  const base = {
    codigo: producto.codigo.trim(),
    nombre: producto.nombre.trim(),
    descripcion: producto.descripcion.trim(),
    categoria: producto.categoria.trim() || null,
  };
  return {
    claveOrigen: borrador.claveOrigen,
    origenUrl: borrador.origenUrl,
    imagenes: borrador.imagenes,
    emitidaAt: borrador.emitidaAt,
    firma: borrador.firma,
    accion: producto.actualizar ? "actualizar" : "crear",
    imagenElegida: producto.imagen,
    producto:
      producto.tipo === "a_medida"
        ? {
            ...base,
            tipo: "a_medida",
            // Se cotiza en pesos, como los presupuestos.
            moneda: "ARS",
            variantes: producto.versiones.map((version) => ({
              nombre: version.nombre.trim(),
              precioCentavos: leerCentavos(version.precio),
            })),
            precioReferenciaCentavos: producto.precioDesde.trim() ? leerCentavos(producto.precioDesde) : null,
            materiales: materialesDe(producto.materiales),
          }
        : {
            ...base,
            tipo: "stock",
            moneda: producto.moneda,
            variantes: producto.variantes.map((variante) => ({
              nombre: variante.nombre.trim(),
              ...(variante.sku.trim() ? { sku: variante.sku.trim() } : {}),
              precioCentavos: leerCentavos(variante.precio),
              stock: entero(variante.stock),
            })),
          },
  };
}

/** Un 403 de la API con este motivo: la cuenta no tiene el Pro. */
export class SinPlanProError extends ErrorDeApi {}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[]; motivo?: string } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    if (res.status === 403 && cuerpo?.motivo === "plan_pro_requerido") throw new SinPlanProError(mensaje ?? "Es del plan Pro.");
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function extraer(urls: string[]): Promise<ResultadoExtraccion> {
  return apiFetch("/importacion/extraer", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ urls }) }).then((res) =>
    json<ResultadoExtraccion>(res),
  );
}

export function confirmar(productos: ProductoEnRevision[]): Promise<ResultadoConfirmacion> {
  return apiFetch("/importacion/confirmar", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ productos: productos.map(itemParaConfirmar) }),
  }).then((res) => json<ResultadoConfirmacion>(res));
}

/** Los enlaces de un texto pegado: uno por línea (o separados por espacios), sin repetir. */
export function enlacesDe(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(/\s+/)
        .map((parte) => parte.trim())
        .filter((parte) => /^https?:\/\//i.test(parte)),
    ),
  ];
}

/** Por qué un enlace no dio productos, dicho para el dueño, con qué hacer. */
export const EXPLICACION_ERROR: Record<CodigoErrorImportacion, string> = {
  url_invalida: "No es un enlace válido. Copialo de nuevo desde la barra del navegador.",
  host_no_permitido: "Ese enlace no se puede leer: tiene que ser una página pública con https.",
  acceso_denegado: "La página no nos dejó leerla. Probá con el enlace de un producto o cargalo a mano.",
  no_encontrada: "La página no existe (o la sacaron). Revisá el enlace.",
  error_del_sitio: "La página respondió con un error. Probá de nuevo en un rato.",
  tipo_no_soportado: "Ese enlace no es una página de producto (puede ser un archivo o una imagen).",
  demasiado_grande: "La página es demasiado pesada para leerla.",
  tiempo_agotado: "La página tardó demasiado en responder. Probá de nuevo o con menos enlaces.",
  sin_conexion: "No pudimos llegar a esa página. Revisá que el enlace esté bien escrito.",
  pagina_no_soportada: "Ese tipo de página no se puede importar.",
  sin_datos_de_producto: "La página no dice qué producto es ni su precio. Cargalo a mano o probá con otro enlace.",
  mercadolibre_no_disponible:
    "Mercado Libre no deja leer sus tiendas ni sus publicaciones desde afuera. Esos productos cargalos a mano o con una planilla.",
  listado_no_soportado: "No pudimos leer los productos de ese listado. Pegá los enlaces de los productos de a uno.",
};

export const EXPLICACION_AVISO: Record<AvisoBorrador, string> = {
  sin_precio: "La página no dice el precio: cargalo vos.",
  sin_moneda: "La página no dice la moneda: elegí pesos o dólares.",
  moneda_no_soportada: "El precio está en otra moneda: cargalo en pesos o en dólares.",
  variantes_recortadas: "Tenía más variantes de las que entran: quedaron las primeras 50.",
  descripcion_recortada: "La descripción era más larga y quedó recortada.",
  sin_descripcion: "No trae descripción: tu asistente la usa para recomendar, conviene agregarla.",
  sin_imagen: "No trae foto.",
  parece_a_medida: "La página habla de hacerlo a medida o de cotizarlo: te sugerimos cargarlo como producto a medida.",
};

export const NOMBRE_FUENTE: Record<FuenteImportacion, string> = {
  mercadolibre: "Mercado Libre",
  tiendamia: "Tiendamia",
  web: "Sitio web",
};
