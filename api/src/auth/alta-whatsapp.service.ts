import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { esAltaPendiente, WhatsappService } from '../whatsapp/whatsapp.service.js';
import { SEGUNDOS_ALTA } from './cookies-de-paso.js';
import { Limitador } from './limitador.js';

/** Sockets de Baileys abiertos a la vez por altas sin terminar. */
export const MAX_ALTAS_SIMULTANEAS = 20;
/** Altas que puede arrancar una misma IP por hora (sólo en producción: los E2E salen todos de localhost). */
export const MAX_ALTAS_POR_IP_HORA = 5;

const UNA_HORA_MS = 60 * 60 * 1000;

/**
 * Crear una cuenta sólo con WhatsApp. `POST /auth/whatsapp/alta` es público y
 * abre un socket de Baileys, así que acá viven los límites: cuántas altas a la
 * vez en total y cuántas por IP. Cada alta sin terminar se descarta sola al
 * vencer su cookie; si la API se reinicia en el medio, la purga diaria de
 * retención borra lo que quede.
 */
@Injectable()
export class AltaWhatsappService implements OnModuleDestroy {
  private readonly logger = new Logger(AltaWhatsappService.name);
  private readonly pendientes = new Map<string, NodeJS.Timeout>();
  private readonly porIp = new Limitador(MAX_ALTAS_POR_IP_HORA, UNA_HORA_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.pendientes.values()) clearTimeout(timer);
  }

  async iniciar(ip: string): Promise<User> {
    const limitaIp = this.config.get('NODE_ENV', { infer: true }) === 'production';
    if (this.pendientes.size >= MAX_ALTAS_SIMULTANEAS || (limitaIp && !this.porIp.permitir(ip))) {
      throw new HttpException('Hay demasiadas altas en curso: probá en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.create({ data: { calendario: 'local' } });
    const timer = setTimeout(() => void this.abandonar(user.id), SEGUNDOS_ALTA * 1000);
    timer.unref();
    this.pendientes.set(user.id, timer);

    try {
      await this.whatsapp.startLink(user.id);
    } catch (error) {
      await this.abandonar(user.id);
      throw error;
    }
    return user;
  }

  /**
   * Después del "connected" del SSE: la cuenta queda creada, o, si el número
   * ya era de otra cuenta, esa cuenta recibe la vinculación nueva y el
   * pendiente se borra. Escanear el QR prueba que se tiene ese WhatsApp, igual
   * que recibir el código en el chat propio.
   */
  async finalizar(userId: string): Promise<User> {
    const [user, sesion] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.whatsappSession.findUnique({ where: { userId } }),
    ]);
    if (!user) throw new ConflictException('El alta venció: empezá de nuevo.');
    if (!esAltaPendiente(user)) {
      // Ya quedó con su número (lo asigna WhatsappService al conectar).
      this.olvidar(userId);
      return user;
    }
    if (!sesion?.registered || !sesion.phoneNumber) {
      throw new ConflictException('Todavía no se vinculó WhatsApp.');
    }

    const existente = await this.prisma.user.findUnique({ where: { phoneNumber: sesion.phoneNumber } });
    if (!existente) {
      // WhatsappService no llegó a asignarlo (carrera con el "connected"): se asigna acá.
      this.olvidar(userId);
      return this.prisma.user.update({ where: { id: userId }, data: { phoneNumber: sesion.phoneNumber } });
    }

    await this.whatsapp.transferirSesion(userId, existente.id);
    this.olvidar(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`Alta por WhatsApp resuelta como ingreso a la cuenta ${existente.id}.`);
    return existente;
  }

  /** Borra un alta que nunca se terminó. No toca cuentas que ya tienen identidad. */
  async abandonar(userId: string): Promise<void> {
    this.olvidar(userId);
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { googleId: true, phoneNumber: true },
      });
      if (!user || !esAltaPendiente(user)) return;
      await this.whatsapp.descartar(userId);
      await this.prisma.user.deleteMany({ where: { id: userId, googleId: null, phoneNumber: null } });
    } catch (error) {
      this.logger.warn(`No se pudo descartar el alta ${userId}: ${(error as Error).message}`);
    }
  }

  private olvidar(userId: string): void {
    const timer = this.pendientes.get(userId);
    if (timer) clearTimeout(timer);
    this.pendientes.delete(userId);
  }
}
