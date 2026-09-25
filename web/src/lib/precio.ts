/** Mismo tope que `TipoEventoDto.precio` en la API: superarlo es un 400. */
export const PRECIO_MAX = 10_000_000;

const FORMATO_PESOS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** 15000 → "$ 15.000". */
export function formatearPrecio(precio: number): string {
  return `$ ${FORMATO_PESOS.format(precio)}`;
}

/** Lo que el usuario tipeó → pesos enteros, o `undefined` si quedó vacío. */
export function leerPrecio(texto: string): number | undefined {
  const digitos = texto.replace(/\D/g, "").slice(0, String(PRECIO_MAX).length);
  if (digitos === "") return undefined;
  return Math.min(Number(digitos), PRECIO_MAX);
}

/** Valor del input: "15.000" (sin el "$", que va como prefijo aparte). */
export function precioParaInput(precio: number | undefined): string {
  return precio === undefined ? "" : FORMATO_PESOS.format(precio);
}
