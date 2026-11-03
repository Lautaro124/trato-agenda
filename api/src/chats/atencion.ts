import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { LARGO_MAX_NOTA } from '../comercio/pedido-a-medida.rules.js';
import { enUnaLinea } from '../comercio/solicitud.rules.js';

/**
 * Quién contesta un chat (LAU-81). Es un único estado por conversación:
 * "humana" calla al asistente en ese chat hasta que el dueño lo devuelve con
 * el botón del panel; no hay vuelta automática. Lo ponen en "humana" el
 * dueño (botón o escribiendo desde su teléfono) y una derivación de pedido
 * (LAU-27, incluido el cobro manual).
 */
export const ATENCIONES_CHAT = ['asistente', 'humana'] as const;
export type AtencionChat = (typeof ATENCIONES_CHAT)[number];

type Db = Prisma.TransactionClient | PrismaClient;

/** La nota del dueño al devolver: una línea, con tope. Se trata como dato. */
export function limpiarNota(nota: string | null | undefined): string | null {
  return nota ? enUnaLinea(nota).slice(0, LARGO_MAX_NOTA) || null : null;
}

/**
 * Pasa el chat a una persona. Si ya lo atendía una, no cambia nada (conserva
 * desde cuándo). Devuelve si cambió.
 */
export async function tomarChat(db: Db, userId: string, conversationId: string, ahora: Date): Promise<boolean> {
  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, userId, atencion: 'asistente' },
    data: { atencion: 'humana', tomadaAt: ahora, devueltaAt: null, notaDevolucion: null },
  });
  return count > 0;
}

/**
 * Le devuelve el chat al asistente, con la nota opcional del dueño. Los
 * pedidos del chat que estaban derivados a una persona quedan devueltos
 * también, con su evento: la pausa es del chat. Devuelve si el chat cambió.
 * Tiene que correr dentro de una transacción.
 */
export async function devolverChat(
  tx: Prisma.TransactionClient,
  userId: string,
  conversationId: string,
  nota: string | null,
  ahora: Date,
): Promise<boolean> {
  const { count } = await tx.conversation.updateMany({
    where: { id: conversationId, userId, atencion: 'humana' },
    data: { atencion: 'asistente', devueltaAt: ahora, notaDevolucion: nota },
  });
  const derivadas = await tx.venta.findMany({
    where: { userId, conversationId, atencion: 'humana' },
    select: { id: true },
  });
  for (const { id } of derivadas) {
    await tx.venta.update({ where: { id }, data: { atencion: 'asistente', devueltaAt: ahora, notaDevolucion: nota } });
    await tx.eventoVenta.create({ data: { ventaId: id, tipo: 'devolucion', de: 'humana', a: 'asistente', autor: 'dueno' } });
  }
  return count > 0;
}

/** ¿Este chat lo atiende una persona? Un chat que todavía no existe, no. */
export async function chatEnAtencionHumana(db: Db, userId: string, remoteJid: string): Promise<boolean> {
  const conversation = await db.conversation.findUnique({
    where: { userId_remoteJid: { userId, remoteJid } },
    select: { atencion: true },
  });
  return conversation?.atencion === 'humana';
}
