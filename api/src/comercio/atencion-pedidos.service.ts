import { Injectable } from '@nestjs/common';
import type { EventoVenta, Message } from '../generated/prisma/client.js';
import { devolverChat, limpiarNota } from '../chats/atencion.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { VentaConItems } from './ventas.service.js';
import { ESTADOS_ABIERTOS } from './ventas.rules.js';

export type DetallePedido = VentaConItems & {
  eventos: EventoVenta[];
  /** Lo último de la conversación, para tomar el caso sin pedirle al cliente que repita. */
  mensajes: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>;
};

/** Mensajes de la conversación que trae el detalle de un pedido. */
const MENSAJES_EN_DETALLE = 40;

/**
 * La atención humana de los pedidos (LAU-27): el detalle que ve el dueño, los
 * que esperan a una persona y devolverle el chat al asistente. Cada
 * método filtra por `userId`: un pedido de otro comercio es como si no existiera.
 */
@Injectable()
export class AtencionPedidosService {
  constructor(private readonly prisma: PrismaService) {}

  /** El detalle para el panel: historial y lo último que se habló. */
  async detalle(userId: string, ventaId: string): Promise<DetallePedido | null> {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, userId },
      include: { items: true, eventos: { orderBy: { createdAt: 'asc' } } },
    });
    if (!venta) return null;
    const mensajes = venta.conversationId
      ? await this.prisma.message.findMany({
          where: { conversationId: venta.conversationId, role: { in: ['user', 'assistant'] } },
          select: { role: true, content: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: MENSAJES_EN_DETALLE,
        })
      : [];
    return { ...venta, mensajes: mensajes.reverse() };
  }

  /** Los pedidos que esperan a una persona, para "Te esperan" del panel. */
  esperandoAtencion(userId: string): Promise<VentaConItems[]> {
    return this.prisma.venta.findMany({
      where: { userId, atencion: 'humana', estado: { in: [...ESTADOS_ABIERTOS] } },
      include: { items: true },
      orderBy: { derivadaAt: 'asc' },
      take: 50,
    });
  }

  /**
   * El dueño le devuelve el chat al asistente desde un pedido. La pausa es del
   * chat: se devuelve la conversación entera con todos sus pedidos derivados.
   */
  async devolver(userId: string, ventaId: string, nota: string | null, ahora: Date = new Date()): Promise<boolean> {
    const venta = await this.prisma.venta.findFirst({ where: { id: ventaId, userId } });
    if (!venta) return false;
    const limpia = limpiarNota(nota);
    await this.prisma.$transaction(async (tx) => {
      if (venta.conversationId) {
        await devolverChat(tx, userId, venta.conversationId, limpia, ahora);
        return;
      }
      if (venta.atencion !== 'humana') return;
      await tx.venta.update({ where: { id: venta.id }, data: { atencion: 'asistente', devueltaAt: ahora, notaDevolucion: limpia } });
      await tx.eventoVenta.create({ data: { ventaId: venta.id, tipo: 'devolucion', de: 'humana', a: 'asistente', autor: 'dueno' } });
    });
    return true;
  }
}
