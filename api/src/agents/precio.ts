/** Tope del precio de un tipo de turno (pesos): ver `TipoEventoDto.precio`. */
export const PRECIO_MAX = 10_000_000;

const FORMATO_PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** 15000 → "$ 15.000". Va al prompt, así que el separador es siempre el mismo. */
export function formatearPrecio(precio: number): string {
  return `$ ${FORMATO_PESOS.format(precio)}`;
}

/** "30 min" o "30 min, $ 15.000" cuando el tipo de turno tiene precio. */
export function detalleDeTipo(tipo: { duracionMin: number; precio?: number }): string {
  return tipo.precio === undefined
    ? `${tipo.duracionMin} min`
    : `${tipo.duracionMin} min, ${formatearPrecio(tipo.precio)}`;
}
