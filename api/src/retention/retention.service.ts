import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CheckpointerService } from '../conversation/checkpointer.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DIAS_RETENCION_DATOS_CLIENTE,
  DIAS_RETENCION_MENSAJES,
  fechaLimite,
} from './retention.rules.js';

/** Cada cuánto se pasa la purga. Diario alcanza: los plazos son de meses. */
const CADA_MS = 24 * 60 * 60 * 1000;

/**
 * Purga periódica de los datos que ya pasaron su plazo de retención.
 *
 * Es un `setInterval` y no `@nestjs/schedule` a propósito: una purga diaria no
 * justifica sumar una dependencia. Es idempotente, así que correrla de más no
 * hace daño, y corre también al arrancar porque la API puede estar días sin
 * reiniciarse igual que puede reiniciarse diez veces en una tarde.
 *
 * Ojo con la réplica única: la API ya está pinneada a una sola instancia por
 * Baileys (ver README), así que no hay dos purgas compitiendo. Si eso cambia,
 * esto necesita un lock.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkpointer: CheckpointerService,
  ) {}

  onModuleInit(): void {
    void this.purgar();
    this.timer = setInterval(() => void this.purgar(), CADA_MS);
    // Sin unref el proceso no termina solo (tests, Ctrl+C).
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purgar(): Promise<void> {
    try {
      const mensajes = await this.purgarMensajes();
      const anonimizadas = await this.anonimizarConversaciones();
      if (mensajes > 0 || anonimizadas > 0) {
        this.logger.log(
          `Retención: ${mensajes} mensajes borrados, ${anonimizadas} conversaciones anonimizadas.`,
        );
      }
    } catch (error) {
      this.logger.error(`Falló la purga de retención: ${(error as Error).message}`);
    }
  }

  /**
   * Conversaciones sin actividad hace más de `DIAS_RETENCION_MENSAJES`: se
   * borran sus `Message` y su thread en el checkpointer. Las dos cosas juntas,
   * porque el estado del grafo guarda los mismos mensajes: borrar sólo la tabla
   * dejaría el historial vivo en el checkpoint.
   *
   * Sólo toca conversaciones inactivas: borrarle el thread a una charla en
   * curso le haría perder el contexto en medio de la coordinación de un turno.
   */
  private async purgarMensajes(): Promise<number> {
    const limite = fechaLimite(DIAS_RETENCION_MENSAJES);
    const viejas = await this.prisma.conversation.findMany({
      where: { updatedAt: { lt: limite }, messages: { some: {} } },
      select: { id: true },
    });
    if (viejas.length === 0) return 0;

    const ids = viejas.map(({ id }) => id);
    const { count } = await this.prisma.message.deleteMany({
      where: { conversationId: { in: ids } },
    });

    for (const id of ids) {
      try {
        await this.checkpointer.saver.deleteThread(id);
      } catch (error) {
        this.logger.warn(`No se pudo borrar el checkpoint de ${id}: ${(error as Error).message}`);
      }
    }

    return count;
  }

  /**
   * Más allá de `DIAS_RETENCION_DATOS_CLIENTE` se van también los dos campos
   * con datos personales del cliente. La fila de `Conversation` queda: su
   * `remoteJid` es la clave con la que se reconoce a quien vuelve a escribir, y
   * los `Turno` que cuelgan de ella son la agenda del titular.
   */
  private async anonimizarConversaciones(): Promise<number> {
    const limite = fechaLimite(DIAS_RETENCION_DATOS_CLIENTE);
    const { count } = await this.prisma.conversation.updateMany({
      where: {
        updatedAt: { lt: limite },
        OR: [{ resumen: { not: null } }, { nombreCliente: { not: null } }],
      },
      data: { resumen: null, nombreCliente: null },
    });
    return count;
  }
}
