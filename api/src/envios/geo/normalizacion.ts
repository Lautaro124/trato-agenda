/**
 * Normalización de nombres y códigos postales para el módulo de envíos
 * (LAU-102). Funciones puras: el catálogo (catalogo.ts) las usa para comparar
 * lo que escribió el cliente con los nombres de Georef.
 */

/** Minúsculas, sin tildes ni puntuación, con los espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Letra de provincia del CPA (Correo Argentino) → id de provincia de Georef.
 * Es la única relación CP → lugar que usamos: no hay catálogo CP → localidad.
 */
export const PROVINCIA_POR_LETRA_CPA: Readonly<Record<string, string>> = {
  A: '66', // Salta
  B: '06', // Buenos Aires
  C: '02', // CABA
  D: '74', // San Luis
  E: '30', // Entre Ríos
  F: '46', // La Rioja
  G: '86', // Santiago del Estero
  H: '22', // Chaco
  J: '70', // San Juan
  K: '10', // Catamarca
  L: '42', // La Pampa
  M: '50', // Mendoza
  N: '54', // Misiones
  P: '34', // Formosa
  Q: '58', // Neuquén
  R: '62', // Río Negro
  S: '82', // Santa Fe
  T: '90', // Tucumán
  U: '26', // Chubut
  V: '94', // Tierra del Fuego
  W: '18', // Corrientes
  X: '14', // Córdoba
  Y: '38', // Jujuy
  Z: '78', // Santa Cruz
};

export type CodigoPostal = {
  /** Los cuatro dígitos: es lo que se compara con las reglas. */
  cp: string;
  /** Sólo si vino con la letra del CPA. */
  provinciaId: string | null;
};

/** "5000", "X5000", "X5000ABC", "cp 5000" → { cp, provinciaId? }; otra cosa → null. */
export function parsearCodigoPostal(texto: string): CodigoPostal | null {
  const limpio = texto
    .toUpperCase()
    .replace(/^\s*(C\.?\s*P\.?|CODIGO POSTAL|CÓDIGO POSTAL)\s*:?\s*/, '')
    .replace(/[\s.-]+/g, '');
  const coincidencia = /^([A-HJ-NP-Z])?(\d{4})([A-Z]{3})?$/.exec(limpio);
  if (!coincidencia) return null;
  const [, letra, cp] = coincidencia;
  return { cp, provinciaId: letra ? (PROVINCIA_POR_LETRA_CPA[letra] ?? null) : null };
}

/**
 * Formas comunes de nombrar una provincia, ya normalizadas. "buenos aires"
 * queda afuera a propósito: puede ser la provincia o la Ciudad, y el
 * catálogo la trata como ambigua.
 */
export const ALIAS_PROVINCIAS: Readonly<Record<string, readonly string[]>> = {
  '02': ['caba', 'capital federal', 'ciudad de buenos aires', 'ciudad autonoma de buenos aires', 'cdad de buenos aires', 'cdad de bs as', 'ciudad de bs as'],
  '06': ['provincia de buenos aires', 'pcia de buenos aires', 'pba', 'bs as', 'bsas', 'pcia de bs as', 'provincia de bs as', 'gba'],
  '14': ['cba', 'cordoba'],
  '30': ['entre rios', 'e rios'],
  '50': ['mza', 'mendoza'],
  '62': ['rio negro'],
  '82': ['sta fe', 'santa fe', 'sfe'],
  '86': ['sgo del estero', 'santiago', 'stgo del estero'],
  '90': ['tucuman', 'tucu'],
  '94': ['tdf', 'tierra del fuego', 'tierra del fuego antartida e islas del atlantico sur'],
};

/** Saca "provincia de" / "pcia." del principio, que el cliente suele agregar. */
export function sinPrefijoProvincia(normalizado: string): string {
  return normalizado.replace(/^(provincia|pcia|prov)( de)? /, '');
}

/** Distancia de edición (Levenshtein), cortada apenas supera `maximo`. */
export function distancia(a: string, b: string, maximo: number): number {
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let minimoFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + costo);
      minimoFila = Math.min(minimoFila, actual[j]);
    }
    if (minimoFila > maximo) return maximo + 1;
    anterior = actual;
  }
  return anterior[b.length];
}

/** Cuántos errores de tipeo se aceptan para sugerir (nunca para elegir). */
export function toleranciaDeTipeo(normalizado: string): number {
  if (normalizado.length < 4) return 0;
  return normalizado.length < 7 ? 1 : 2;
}
