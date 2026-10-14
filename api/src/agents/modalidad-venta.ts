/**
 * Modalidad de venta del asistente de ventas (LAU-21), en `Agent.modalidadVenta`:
 * - "stock": lo de siempre — precio y stock del catálogo, reserva y link de pago.
 * - "pedido": el comercio hace o consigue cada pedido. El asistente no habla de
 *   stock ni cierra la compra: toma la solicitud y se la pasa al dueño para que
 *   la cotice. Para eso necesita saber qué hace el comercio (`Agent.queHace`).
 *
 * Puro (sin base ni red), igual que local.ts: lo usan el endpoint que lo guarda
 * y las reglas del prompt que se arman en cada mensaje (reglas-ventas.ts), así
 * que cambiarlo no regenera el system prompt.
 */
import type { Agent } from '../generated/prisma/client.js';

export const MODALIDADES_VENTA = ['stock', 'pedido'] as const;
export type ModalidadVenta = (typeof MODALIDADES_VENTA)[number];

/** Menos que esto no le dice al asistente qué pedidos tomar. */
export const MIN_QUE_HACE = 30;
/** Va entero en el prompt de cada mensaje: acotado. */
export const MAX_QUE_HACE = 600;

/** Cualquier valor que no sea "pedido" es "stock": el comportamiento de siempre. */
export function leerModalidad(agent: Pick<Agent, 'modalidadVenta'>): ModalidadVenta {
  return agent.modalidadVenta === 'pedido' ? 'pedido' : 'stock';
}

/** Saca los espacios de las puntas y junta los repetidos (los saltos de línea, también). */
export function normalizarQueHace(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/** El "qué hacés" guardado, o null si no hay uno usable. */
export function leerQueHace(agent: Pick<Agent, 'queHace'>): string | null {
  const texto = agent.queHace ? normalizarQueHace(agent.queHace) : '';
  return texto.length >= MIN_QUE_HACE ? texto : null;
}

/**
 * El motivo para rechazar la combinación, o null si está bien. A pedido sin
 * "qué hacés" el asistente no sabe qué solicitudes tomar, así que es obligatorio;
 * con stock se acepta cualquiera (o ninguno) dentro del largo máximo.
 */
export function problemaDeModalidad(modalidad: ModalidadVenta, queHace: string | null | undefined): string | null {
  const texto = queHace ? normalizarQueHace(queHace) : '';
  if (texto.length > MAX_QUE_HACE) return `Contá qué hacés en ${MAX_QUE_HACE} caracteres como mucho.`;
  if (modalidad === 'pedido' && texto.length < MIN_QUE_HACE) {
    return `Para vender a pedido contá qué hacés en al menos ${MIN_QUE_HACE} caracteres.`;
  }
  return null;
}
