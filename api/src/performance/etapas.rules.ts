/**
 * Etapas de un chat de ventas para el módulo de performance (LAU-30), como
 * reglas puras. Definiciones en docs/performance.md.
 *
 * Las etapas se acumulan: cada chat queda en la más avanzada que alcanzó y
 * nunca retrocede. Por eso avanzar es un `updateMany` que sólo toca las filas
 * que están en una etapa anterior (`etapasAnterioresA`): el pago que llega
 * por webhook y el chat que sigue hablando no se pisan.
 */

/** En orden. "eligiendo" y "lista" las da Jev y sólo existen si la cuenta lo usa. */
export const ETAPAS = ['consulta', 'vio_productos', 'eligiendo', 'lista', 'pedido', 'cotizado', 'pagado'] as const;
export type Etapa = (typeof ETAPAS)[number];

/** Lo que guarda InteresProducto: el producto apareció en lo que se le mostró, o lo pidió. */
export const TIPOS_INTERES = ['vio', 'pidio'] as const;
export type TipoInteres = (typeof TIPOS_INTERES)[number];

/** La etapa a la que lleva cada tipo de interés. */
export const ETAPA_DE_INTERES: Record<TipoInteres, Etapa> = { vio: 'vio_productos', pidio: 'pedido' };

/** Las etapas que vienen antes de `etapa`: desde esas se puede avanzar a ella. */
export function etapasAnterioresA(etapa: Etapa): Etapa[] {
  return ETAPAS.slice(0, ETAPAS.indexOf(etapa));
}
