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
  // Excel guarda los precios como número: 1500.5 se manda con punto decimal,
  // que la API entiende igual que "1.500,50".
  return String(celda).trim();
}

/** Lee un .csv o un .xlsx y devuelve sus filas como objetos. */
export async function leerPlanilla(archivo: File): Promise<FilaPlanilla[]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".xlsx")) {
    // Import dinámico: el lector de Excel sólo se descarga si hace falta.
    const { readSheet } = await import("read-excel-file/browser");
    return filasAObjetos(await readSheet(archivo));
  }
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
    return filasAObjetos(parsearCsv(await archivo.text()));
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
