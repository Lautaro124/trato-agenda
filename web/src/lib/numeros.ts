/**
 * Números en los campos de los formularios: se muestran con punto de miles
 * ("1.000", "1.000.000") mientras se escriben, y con coma decimal si el campo
 * acepta centavos ("1.500,50"). Los montos se leen con `leerCentavos`
 * (productos.ts), que ya acepta este formato; los enteros, con `leerEntero`.
 */

const MILES = /\B(?=(\d{3})+(?!\d))/g;

/** "001500" → "1.500". */
function agrupar(digitos: string): string {
  return digitos.replace(/^0+(?=\d)/, "").replace(MILES, ".");
}

/**
 * Lo que hay en el campo → el mismo número con punto de miles. Con
 * `decimales`, la primera coma separa hasta dos decimales; los puntos que no
 * son de miles se descartan (el separador decimal es la coma).
 */
export function formatearNumeroEnEdicion(texto: string, decimales = false): string {
  const coma = decimales ? texto.indexOf(",") : -1;
  const entera = agrupar((coma === -1 ? texto : texto.slice(0, coma)).replace(/\D/g, ""));
  if (coma === -1) return entera;
  return `${entera || "0"},${texto.slice(coma + 1).replace(/\D/g, "").slice(0, 2)}`;
}

/** Dígitos y comas: lo que no cambia de lugar al reformatear. */
export function significativos(texto: string): number {
  return texto.replace(/[^\d,]/g, "").length;
}

/** La posición del cursor que deja `cantidad` caracteres significativos a su izquierda. */
export function posicionTrasSignificativos(texto: string, cantidad: number): number {
  if (cantidad <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) {
    if (/[\d,]/.test(texto[i]) && ++vistos === cantidad) return i + 1;
  }
  return texto.length;
}

/**
 * Un entero tipeado, con o sin punto de miles: "1500" o "1.500". null si
 * está vacío, "invalido" si no es un entero (o supera `maxDigitos`).
 */
export function leerEntero(texto: string, maxDigitos = 15): number | null | "invalido" {
  const limpio = texto.trim();
  if (limpio === "") return null;
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(limpio)) return "invalido";
  const digitos = limpio.replace(/\./g, "");
  return digitos.length <= maxDigitos ? Number(digitos) : "invalido";
}
