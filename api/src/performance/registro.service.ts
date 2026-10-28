import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ETAPA_DE_INTERES, etapasAnterioresA, type Etapa, type TipoInteres } from './etapas.rules.js';
import { zonaDeDatosCliente, zonaDeJid } from './zona.rules.js';

/** Prefijo del chat del banco de pruebas del Home (conversation.service.ts): nunca se registra. */
const PREFIJO_CHAT_DE_PRUEBA = 'web-test:';

/** Lo mínimo de una venta para saber a qué chat sumarle la etapa. */
export type VentaDelChat = { userId: string; conversationId: string | null; dePrueba: boolean };

/**
 * Registro del módulo de performance (LAU-30): la etapa de cada chat de ventas
 * (EtapaChat) y los productos que vio o pidió (InteresProducto). Definiciones
 * en docs/performance.md.
 *
 * Todo es de mejor esfuerzo: si una escritura falla queda en el log (sólo
 * ids) y sigue, porque una métrica nunca puede tirar abajo una venta ni la
 * respuesta al cliente. Los chats del banco de pruebas no se registran, y una
 * conversación o un producto de otra cuenta se ignoran.
 */
@Injectable()
export class RegistroPerformanceService {
  private readonly logger = new Logger(RegistroPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cada mensaje del cliente: marca la actividad y, si Jev calculó la etapa
   * de compra, la guarda y avanza el chat hasta ella. Si el chat todavía no
   * tiene zona, la infiere de la característica (sin guardar el número).
   */
  async tocarChat(
    userId: string,
    conversationId: string,
    opciones: { etapaJev?: 'eligiendo' | 'lista' | null; ahora?: Date } = {},
  ): Promise<void> {
    await this.seguro('tocarChat', conversationId, async () => {
      const remoteJid = await this.asegurar(userId, conversationId);
      if (!remoteJid) return;
      await this.prisma.etapaChat.updateMany({
        where: { userId, conversationId },
        data: { ultimaActividadAt: opciones.ahora ?? new Date(), ...(opciones.etapaJev ? { etapaJev: opciones.etapaJev } : {}) },
      });
      const inferida = zonaDeJid(remoteJid);
      if (inferida) {
        await this.prisma.etapaChat.updateMany({
          where: { userId, conversationId, provincia: null },
          data: { provincia: inferida, origenZona: 'inferida' },
        });
      }
      if (opciones.etapaJev) await this.subirA(userId, conversationId, opciones.etapaJev);
    });
  }

  /** Productos que el chat vio o pidió. Sólo los de la cuenta; repetidos no cuentan dos veces. */
  async registrarInteres(userId: string, conversationId: string, productoIds: string[], tipo: TipoInteres): Promise<void> {
    await this.seguro(`registrarInteres ${tipo}`, conversationId, async () => {
      await this.interes(userId, conversationId, productoIds, tipo);
    });
  }

  /** crear_pedido sólo trae variantes: se las lleva a su producto, dentro de la cuenta. */
  async registrarPedidoDeVariantes(userId: string, conversationId: string, varianteIds: string[]): Promise<void> {
    await this.seguro('registrarPedidoDeVariantes', conversationId, async () => {
      const ids = [...new Set(varianteIds)];
      if (ids.length === 0) return;
      const variantes = await this.prisma.variante.findMany({
        where: { id: { in: ids }, producto: { userId } },
        select: { productoId: true },
      });
      await this.interes(userId, conversationId, variantes.map((variante) => variante.productoId), 'pidio');
    });
  }

  /**
   * Los datos que dio el cliente en un pedido: si dicen la provincia (o un
   * código postal con letra), esa es la zona del chat, aunque ya hubiera una
   * inferida. Se guarda sólo la provincia.
   */
  async registrarZonaDeDatos(
    userId: string,
    conversationId: string,
    datos: Array<{ etiqueta: string; valor: string }>,
  ): Promise<void> {
    const zona = zonaDeDatosCliente(datos);
    if (!zona) return;
    await this.seguro('registrarZonaDeDatos', conversationId, async () => {
      if (!(await this.asegurar(userId, conversationId))) return;
      await this.prisma.etapaChat.updateMany({ where: { userId, conversationId }, data: { provincia: zona, origenZona: 'dato' } });
    });
  }

  /** El chat se derivó a una persona (derivar_consulta o atención humana). */
  async marcarDerivado(userId: string, conversationId: string): Promise<void> {
    await this.seguro('marcarDerivado', conversationId, async () => {
      if (!(await this.asegurar(userId, conversationId))) return;
      await this.prisma.etapaChat.updateMany({ where: { userId, conversationId }, data: { derivado: true } });
    });
  }

  /** Una venta que avanzó (cotizada, pagada) lleva su chat a esa etapa. Las de prueba no cuentan. */
  async avanzarPorVenta(venta: VentaDelChat, etapa: Etapa): Promise<void> {
    const { conversationId } = venta;
    if (!conversationId || venta.dePrueba) return;
    await this.seguro(`avanzarPorVenta ${etapa}`, conversationId, async () => {
      if (!(await this.asegurar(venta.userId, conversationId))) return;
      await this.subirA(venta.userId, conversationId, etapa);
    });
  }

  private async interes(userId: string, conversationId: string, productoIds: string[], tipo: TipoInteres): Promise<void> {
    const ids = [...new Set(productoIds)];
    if (ids.length === 0) return;
    if (!(await this.asegurar(userId, conversationId))) return;
    const propios = await this.prisma.producto.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    if (propios.length === 0) return;
    await this.prisma.interesProducto.createMany({
      data: propios.map((producto) => ({ userId, conversationId, productoId: producto.id, tipo })),
      skipDuplicates: true,
    });
    await this.subirA(userId, conversationId, ETAPA_DE_INTERES[tipo]);
  }

  /**
   * Deja la fila del chat creada y devuelve el remoteJid de la conversación
   * (sólo para inferir la zona; no se guarda). Null (y no crea nada) si la
   * conversación no es de esta cuenta o es la del banco de pruebas.
   * `createMany` + `skipDuplicates` es un INSERT … ON CONFLICT DO NOTHING:
   * dos escrituras a la vez no chocan.
   */
  private async asegurar(userId: string, conversationId: string): Promise<string | null> {
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId, NOT: { remoteJid: { startsWith: PREFIJO_CHAT_DE_PRUEBA } } },
      select: { remoteJid: true },
    });
    if (!conversacion) return null;
    await this.prisma.etapaChat.createMany({ data: [{ userId, conversationId }], skipDuplicates: true });
    return conversacion.remoteJid;
  }

  /** Avanza sólo si el chat está antes: nunca retrocede, y es atómico. */
  private async subirA(userId: string, conversationId: string, etapa: Etapa): Promise<void> {
    await this.prisma.etapaChat.updateMany({
      where: { userId, conversationId, etapa: { in: etapasAnterioresA(etapa) } },
      data: { etapa },
    });
  }

  private async seguro(que: string, conversationId: string, accion: () => Promise<void>): Promise<void> {
    try {
      await accion();
    } catch (error) {
      this.logger.error(`No se pudo registrar ${que} de la conversación ${conversationId}: ${(error as Error).message}`);
    }
  }
}
