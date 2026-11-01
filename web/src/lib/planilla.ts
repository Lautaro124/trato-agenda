/**
 * Lectura de planillas (CSV o Excel) del lado del navegador: el archivo nunca
 * viaja entero a la API, sólo sus filas como JSON. La validación de cada
 * celda la hace la API (catalogo.rules.ts), que devuelve los errores por fila.
 */

/** Tope de filas que acepta la API por importación. */
export const MAX_FILAS = 5_000;

/** Columnas de la plantilla, en el mismo orden que COLUMNAS_IMPORTACION de la API. */
export const COLUMNAS = [
  "codigo",
  "nombre",
  "descripcion",
  "categoria",
  "variante",
  "sku",
  "precio",
  "stock",
  "stock_minimo",
  "disponible",
  "moneda",
] as const;

export type FilaPlanilla = Record<string, string>;

/**
 * Parser de CSV (RFC 4180): comillas, comillas escapadas y saltos de línea
 * dentro de un campo. El separador se detecta en la primera línea, porque un
 * Excel en español exporta con ";" y uno en inglés con ",".
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, "");
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? "";
  const separador = [";", ",", "\t"]
    .map((candidato) => ({ candidato, cantidad: primeraLinea.split(candidato).length }))
    .sort((a, b) => b.cantidad - a.cantidad)[0].candidato;

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const letra = limpio[i];
    if (entreComillas) {
      if (letra === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (letra === '"') {
        entreComillas = false;
      } else {
        campo += letra;
      }
    } else if (letra === '"') {
      entreComillas = true;
    } else if (letra === separador) {
      fila.push(campo);
      campo = "";
    } else if (letra === "\n" || letra === "\r") {
      if (letra === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += letra;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/**
 * Primera fila = encabezados; el resto, objetos encabezado → valor. Las filas
 * vacías del medio se mandan igual (la API las saltea) para que el número de
 * fila de cada error coincida con el de la planilla; las del final se cortan.
 */
export function filasAObjetos(filas: unknown[][]): FilaPlanilla[] {
  const [encabezados, ...datos] = filas;
  if (!encabezados) return [];
  const claves = encabezados.map((celda) => String(celda ?? "").trim());
  const vacia = (fila: unknown[]) => fila.every((celda) => String(celda ?? "").trim() === "");
  let fin = datos.length;
  while (fin > 0 && vacia(datos[fin - 1])) fin--;
  return datos
    .slice(0, fin)
    .map((fila) =>
      Object.fromEntries(
        claves.map((clave, indice) => [clave, celdaATexto(fila[indice])]).filter(([clave]) => clave !== ""),
      ),
    );
}

function celdaATexto(celda: unknown): string {
  if (celda === null || celda === undefined) return "";
  if (typeof celda === "boolean") return celda ? "si" : "no";
  // Una fecha en una celda de precio o stock es un error de la planilla: no se manda
  // como fecha ISO, que la API leería como un precio "inválido" sin explicar por qué.
  if (celda instanceof Date) return "";
  // Excel guarda los precios como número: 1500.5 se manda con punto decimal,
  // que la API entiende igual que "1.500,50". El ruido de float (15000.000000000002)
  // se redondea a centavos antes de mandarlo.
  if (typeof celda === "number") return Number.isFinite(celda) ? String(Math.round(celda * 100) / 100) : "";
  return String(celda).trim();
}

/** Igual que `normalizarColumna` de la API: "Stock mínimo" → "stock_minimo". */
export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Lo que tiene la fila en esa columna, sin importar cómo se escribió el encabezado ("Código", "codigo"). */
export function valorDeFila(fila: FilaPlanilla | undefined, columna: string): string {
  if (!fila) return "";
  const clave = Object.keys(fila).find((k) => normalizarEncabezado(k) === columna);
  return clave === undefined ? "" : fila[clave];
}

/** Copia de la fila con la columna cambiada, respetando el encabezado que ya tenía. */
export function conValor(fila: FilaPlanilla, columna: string, valor: string): FilaPlanilla {
  const clave = Object.keys(fila).find((k) => normalizarEncabezado(k) === columna) ?? columna;
  return { ...fila, [clave]: valor };
}

/** Cómo se llama cada columna de la plantilla cuando se le habla al usuario. */
export const ETIQUETAS_COLUMNA: Record<string, string> = {
  codigo: "Código",
  nombre: "Nombre",
  descripcion: "Descripción",
  categoria: "Categoría",
  variante: "Variante",
  sku: "SKU",
  precio: "Precio",
  stock: "Stock",
  stock_minimo: "Stock mínimo",
  disponible: "Disponible",
  moneda: "Moneda",
};

/** Columnas sin las que ninguna fila puede importarse. */
export const COLUMNAS_OBLIGATORIAS = ["codigo", "nombre", "precio"] as const;

/** Las obligatorias que la primera fila (encabezados) no trae, para avisarlo una vez y no en cada fila. */
export function columnasFaltantes(encabezados: unknown[]): string[] {
  const presentes = new Set(encabezados.map((celda) => normalizarEncabezado(String(celda ?? ""))));
  return COLUMNAS_OBLIGATORIAS.filter((columna) => !presentes.has(columna));
}

/** Decodifica un CSV: UTF-8 y, si no es válido (Excel en español guarda en Windows-1252), Windows-1252. */
export async function textoDeCsv(archivo: File): Promise<string> {
  const bytes = await archivo.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function conEncabezadosValidos(filas: unknown[][]): FilaPlanilla[] {
  if (filas.length === 0) return [];
  const faltan = columnasFaltantes(filas[0]);
  if (faltan.length > 0) throw new Error(`columnas:${faltan.join(",")}`);
  return filasAObjetos(filas);
}

// --- Export de publicaciones de Mercado Libre ----------------------------------

/** Las columnas del export que usa Trato, por su código en la primera fila de la hoja. */
const COLUMNAS_MERCADOLIBRE = {
  codigo: "ITEM_ID",
  nombre: "TITLE",
  variante: "VARIATIONS",
  precio: "PRICE",
  precioPromocion: "SALE_PRICE",
  stock: "QUANTITY",
  moneda: "CURRENCY_ID",
  idVariante: "VARIATION_ID",
} as const;
const SKU_MERCADOLIBRE = ["SELLER_SKU", "SKU"];

/** Cómo se llaman las columnas en el export de Mercado Libre, para los errores. */
export const ETIQUETAS_MERCADOLIBRE: Record<string, string> = {
  ...ETIQUETAS_COLUMNA,
  codigo: "Número de publicación",
  nombre: "Título",
  variante: "Variantes",
  stock: "Stock en tu depósito",
};

/** Igual que `esIdMercadoLibre` de la API: "MLA123456789", "MCO…". */
const ID_MERCADOLIBRE = /^M[A-Z]{2}\d{6,}$/;

/**
 * La hoja "Publicaciones" del export: la primera fila son los códigos de
 * columna (ITEM_ID, TITLE…) y las siguientes, títulos y ayudas hasta la
 * primera publicación. Esas filas se mandan vacías (la API las saltea) para
 * que el número de fila de cada error siga siendo el de la planilla. Cada
 * publicación (o variante) pasa a una fila de la plantilla: el número de
 * publicación es el código y el precio, el de promoción si lo tiene.
 * Descripción y categoría no vienen y no se mandan, así no se pisan.
 */
export function filasDeMercadoLibre(filas: unknown[][]): FilaPlanilla[] {
  const [codigos, ...datos] = filas;
  const indice = new Map((codigos ?? []).map((celda, i) => [celdaATexto(celda).toUpperCase(), i]));
  const faltan = [COLUMNAS_MERCADOLIBRE.codigo, COLUMNAS_MERCADOLIBRE.nombre, COLUMNAS_MERCADOLIBRE.precio].filter(
    (codigo) => !indice.has(codigo),
  );
  if (faltan.length > 0) throw new Error(`columnas:${faltan.join(",")}`);

  const valor = (fila: unknown[], codigo: string) => {
    const i = indice.get(codigo);
    return i === undefined ? "" : celdaATexto(fila[i]);
  };
  const columnaSku = SKU_MERCADOLIBRE.find((codigo) => indice.has(codigo));
  const primera = datos.findIndex((fila) => ID_MERCADOLIBRE.test(valor(fila, COLUMNAS_MERCADOLIBRE.codigo)));
  if (primera === -1) return [];

  const convertidas = datos.map((fila, i): FilaPlanilla => {
    if (i < primera) return {};
    const codigo = valor(fila, COLUMNAS_MERCADOLIBRE.codigo);
    const idVariante = valor(fila, COLUMNAS_MERCADOLIBRE.idVariante);
    // El SKU del vendedor si lo cargó; si no, uno estable que sale de la publicación y la variante.
    const sku = (columnaSku && valor(fila, columnaSku)) || (idVariante ? `${codigo}-${idVariante}` : codigo);
    return {
      codigo,
      nombre: valor(fila, COLUMNAS_MERCADOLIBRE.nombre),
      variante: valor(fila, COLUMNAS_MERCADOLIBRE.variante),
      sku: codigo ? sku : "",
      precio: valor(fila, COLUMNAS_MERCADOLIBRE.precioPromocion) || valor(fila, COLUMNAS_MERCADOLIBRE.precio),
      stock: valor(fila, COLUMNAS_MERCADOLIBRE.stock),
      moneda: valor(fila, COLUMNAS_MERCADOLIBRE.moneda),
    };
  });
  let fin = convertidas.length;
  while (fin > 0 && Object.values(convertidas[fin - 1]).every((celda) => celda === "")) fin--;
  return convertidas.slice(0, fin);
}

export type Planilla = {
  filas: FilaPlanilla[];
  /** Los nombres de columna que conoce el usuario, para hablarle de sus errores. */
  etiquetas: Record<string, string>;
};

/** El export de Mercado Libre trae la hoja "Publicaciones" con ITEM_ID en la primera fila. */
function hojaDeMercadoLibre(hojas: Array<{ sheet: string; data: unknown[][] }>) {
  return hojas.find(
    (hoja) =>
      normalizarEncabezado(hoja.sheet) === "publicaciones" &&
      (hoja.data[0] ?? []).some((celda) => celdaATexto(celda).toUpperCase() === COLUMNAS_MERCADOLIBRE.codigo),
  );
}

/** Lee un .csv o un .xlsx (la plantilla o el export de Mercado Libre) y devuelve sus filas como objetos. */
export async function leerPlanilla(archivo: File): Promise<Planilla> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".xlsx")) {
    // Import dinámico: el lector de Excel sólo se descarga si hace falta.
    const { default: leerHojas } = await import("read-excel-file/browser");
    const hojas = await leerHojas(archivo);
    // La hoja de Ayuda y las ocultas del export no son productos: sólo se lee la de publicaciones.
    const mercadoLibre = hojaDeMercadoLibre(hojas);
    if (mercadoLibre) return { filas: filasDeMercadoLibre(mercadoLibre.data), etiquetas: ETIQUETAS_MERCADOLIBRE };
    return { filas: conEncabezadosValidos(hojas[0]?.data ?? []), etiquetas: ETIQUETAS_COLUMNA };
  }
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
    return { filas: conEncabezadosValidos(parsearCsv(await textoDeCsv(archivo))), etiquetas: ETIQUETAS_COLUMNA };
  }
  throw new Error("formato");
}

/** CSV de ejemplo con las columnas de la plantilla, listo para descargar. */
export function plantillaCsv(): string {
  const filas = [
    [...COLUMNAS],
    ["REM-01", "Remera básica", "Algodón peinado, corte recto", "Remeras", "Talle M", "", "15000", "10", "2", "", "ARS"],
    ["REM-01", "Remera básica", "Algodón peinado, corte recto", "Remeras", "Talle L", "", "15000", "4", "2", "", "ARS"],
    ["MATE-01", "Mate de calabaza", "Curado, con virola de alpaca", "Mates", "", "", "8000", "", "", "si", ""],
    ["AURI-01", "Auriculares inalámbricos", "Bluetooth, con estuche", "Tecnología", "", "", "25", "3", "", "", "USD"],
  ];
  return (
    "\uFEFF" +
    filas.map((fila) => fila.map((celda) => (/[;"\n]/.test(celda) ? `"${celda.replace(/"/g, '""')}"` : celda)).join(";")).join("\r\n")
  );
}
