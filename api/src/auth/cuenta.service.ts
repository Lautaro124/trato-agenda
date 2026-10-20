import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { CheckpointerService } from '../conversation/checkpointer.provider.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { huellasDeIdentidad } from '../subscription/prueba-consumida.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { revocarTokenDeGoogle } from './google-revoke.js';
import { decryptToken } from './token-crypto.js';

/**
 * Baja de cuenta: borra todo lo que la app guarda de una persona y devuelve el
 * acceso a su Google Calendar. Es lo que hace cumplible la promesa de
 * /privacidad, y es un requisito de la verificación OAuth de Google.
 *
 * Vive aparte de `AuthService` porque toca cuatro subsistemas (Google,
 * Mercado Pago, WhatsApp y el checkpointer de LangGraph) y `AuthService` es el
 * que usa el login: no conviene arrastrarle esas dependencias.
 */
@Injectable()
export class CuentaService {
  private readonly logger = new Logger(CuentaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly whatsapp: WhatsappService,
    private readonly suscripciones: SubscriptionService,
    private readonly checkpointer: CheckpointerService,
  ) {}

  /**
   * El orden importa: todo lo que necesita datos del usuario va antes del
   * `delete`, y cada paso externo es best-effort — si Mercado Pago o WhatsApp
   * fallan, la persona igual tiene que poder irse.
   */
  async eliminar(user: User): Promise<void> {
    // Primero, y sin best-effort: si no queda la lápida, borrar la cuenta
    // permitiría reiniciar el mes de prueba. Falla antes de tocar nada más.
    await this.dejarLapidaDePrueba(user);
    await this.revocarGoogle(user);
    await this.cancelarSuscripcion(user.id);
    await this.desvincularWhatsapp(user.id);
    await this.borrarCheckpoints(user.id);

    // Cascade en el schema: WhatsappSession, Agent, Conversation (con sus
    // Message y Turno), Subscription, Evento y, en un comercio, Producto (con
    // sus variantes), Venta (con sus ítems), Notificacion, CuentaMercadoPago y
    // SugerenciaMejora se van con el usuario (cuenta.db.spec.ts lo verifica).
    // Los tokens de Mercado Pago del vendedor se borran con la fila; la
    // autorización del lado de Mercado Pago la quita el vendedor desde su
    // cuenta, y /privacidad le dice cómo. Los issues que una sugerencia ya
    // creó en Linear quedan: llevan el texto y el id interno, sin teléfono ni
    // mail.
    await this.prisma.user.delete({ where: { id: user.id } });

    // La lápida de la prueba (hash + fecha de alta) queda a propósito: es lo
    // único que sobrevive a la baja, y /privacidad lo dice.
    // Los eventos que el asistente ya creó en el Google Calendar del titular
    // NO se borran: son eventos de su calendario, y borrarlos sería destruir
    // datos que no son nuestros. /privacidad lo dice explícito.
    this.logger.log(`Cuenta eliminada: ${user.id}`);
  }

  /**
   * Deja un HMAC de cada identidad con la fecha de alta, para que volver a
   * crear la cuenta no regale otro mes de prueba (ver `prueba-consumida.ts`).
   * Si la identidad ya tenía lápida se conserva la más antigua.
   */
  private async dejarLapidaDePrueba(user: User): Promise<void> {
    const huellas = huellasDeIdentidad(user, this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true }));
    for (const huella of huellas) {
      const previa = await this.prisma.pruebaConsumida.findUnique({ where: { huella } });
      if (previa && previa.inicio <= user.createdAt) continue;
      await this.prisma.pruebaConsumida.upsert({
        where: { huella },
        create: { huella, inicio: user.createdAt },
        update: { inicio: user.createdAt },
      });
    }
  }

  private async revocarGoogle(user: User): Promise<void> {
    if (!user.googleRefreshToken) return;

    let token: string;
    try {
      token = decryptToken(
        user.googleRefreshToken,
        this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true }),
      );
    } catch {
      this.logger.warn(`No se pudo descifrar el token de ${user.id} para revocarlo.`);
      return;
    }

    const revocado = await revocarTokenDeGoogle(token);
    if (!revocado) {
      // Pasa cuando ya lo revocó desde myaccount.google.com. El borrado sigue.
      this.logger.warn(`Google no confirmó la revocación del token de ${user.id}.`);
    }
  }

  private async cancelarSuscripcion(userId: string): Promise<void> {
    const suscripcion = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!suscripcion?.mpPreapprovalId || suscripcion.estado === 'cancelada') return;

    try {
      await this.suscripciones.cancelar(userId);
    } catch (error) {
      // Si no se cancela, quedaría un preapproval cobrando contra un usuario
      // que ya no existe: se avisa fuerte pero no se bloquea la baja.
      this.logger.error(
        `No se pudo cancelar la suscripción de ${userId} al borrar la cuenta: ${(error as Error).message}`,
      );
    }
  }

  private async desvincularWhatsapp(userId: string): Promise<void> {
    try {
      // Cierra el socket de Baileys; la fila se va igual por cascade.
      await this.whatsapp.unlink(userId);
    } catch (error) {
      this.logger.warn(`No se pudo cerrar la sesión de WhatsApp de ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Las tablas del checkpointer de LangGraph están fuera de las migraciones de
   * Prisma, así que el `onDelete: Cascade` del usuario no las toca: sin esto,
   * el historial completo de cada conversación quedaría huérfano en la base
   * después de borrar la cuenta. El `thread_id` es el `Conversation.id`.
   */
  private async borrarCheckpoints(userId: string): Promise<void> {
    const conversaciones = await this.prisma.conversation.findMany({
      where: { userId },
      select: { id: true },
    });

    for (const { id } of conversaciones) {
      try {
        await this.checkpointer.saver.deleteThread(id);
      } catch (error) {
        this.logger.error(
          `No se pudo borrar el checkpoint de la conversación ${id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
