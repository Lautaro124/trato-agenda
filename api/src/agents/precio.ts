import { detalleGrupal, esGrupal, type HorarioGrupal } from './turnos-grupales.js';

/** Tope del precio de un tipo de turno (pesos): ver `TipoEventoDto.precio`. */
export const PRECIO_MAX = 10_000_000;

const FORMATO_PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** 15000 → "$ 15.000". Va al prompt, así que el separador es siempre el mismo. */
export function formatearPrecio(precio: number): string {
  return `$ ${FORMATO_PESOS.format(precio)}`;
}

/**
 * "30 min", "30 min, $ 15.000" cuando el tipo de turno tiene precio, y
 * "…, grupal de hasta 10 personas: lunes 18:00" cuando es grupal. La duración
 * va siempre primero y seguida de "," o ")": el stub de las E2E la lee así.
 */
export function detalleDeTipo(tipo: {
  duracionMin: number;
  precio?: number;
  capacidad?: number;
  horarios?: HorarioGrupal[];
}): string {
  const partes = [`${tipo.duracionMin} min`];
  if (tipo.precio !== undefined) partes.push(formatearPrecio(tipo.precio));
  if (esGrupal(tipo)) partes.push(detalleGrupal(tipo));
  return partes.join(', ');
}
