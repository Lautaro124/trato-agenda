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
    .replace(/^_+|_+$/g, "");
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

/** Lee un .csv o un .xlsx y devuelve sus filas como objetos. */
export async function leerPlanilla(archivo: File): Promise<FilaPlanilla[]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".xlsx")) {
    // Import dinámico: el lector de Excel sólo se descarga si hace falta.
    const { readSheet } = await import("read-excel-file/browser");
    return conEncabezadosValidos(await readSheet(archivo));
  }
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
    return conEncabezadosValidos(parsearCsv(await textoDeCsv(archivo)));
  }
  throw new Error("formato");
}

/** CSV de ejemplo con las columnas de la plantilla, listo para descargar. */
export function plantillaCsv(): string {
  const filas = [
    [...COLUMNAS],
    ["REM-01", "Remera básica", "Algodón peinado, corte recto", "Remeras", "Talle M", "", "15000", "10", "2", ""],
    ["REM-01", "Remera básica", "Algodón peinado, corte recto", "Remeras", "Talle L", "", "15000", "4", "2", ""],
    ["MATE-01", "Mate de calabaza", "Curado, con virola de alpaca", "Mates", "", "", "8000", "", "", "si"],
  ];
  return (
    "\uFEFF" +
    filas.map((fila) => fila.map((celda) => (/[;"\n]/.test(celda) ? `"${celda.replace(/"/g, '""')}"` : celda)).join(";")).join("\r\n")
  );
}
