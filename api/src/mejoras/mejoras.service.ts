import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { resumenDeError } from '../agents/openrouter.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinearClient } from './linear.client.js';
import {
  MAX_POR_DIA,
  descripcionParaLinear,
  esTipoSugerencia,
  tituloParaLinear,
  validarSugerencia,
  type TipoSugerencia,
} from './mejoras.rules.js';

/** Cada cuánto se reintentan las pendientes. */
const CADA_MS = 10 * 60 * 1000;
/** Después de tantos intentos fallidos una sugerencia deja de reintentarse (sigue en la base). */
export const MAX_INTENTOS = 10;
/** De a cuántas por barrido. */
const POR_BARRIDO = 20;
/**
 * El barrido no toca las recién creadas: a esas las está mandando el envío
 * inmediato, y tomarlas también duplicaría el issue.
 */
const GRACIA_MS = 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Sugerencias de mejora (LAU-14). Se guardan siempre primero; la copia a
 * Linear va después y por fuera de la respuesta, así una caída de Linear no
 * le hace perder nada al usuario. `setInterval` y réplica única, igual que
 * ConciliacionService. Los logs llevan ids y códigos, nunca el texto.
 */
@Injectable()
export class MejorasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MejorasService.name);
  private timer?: NodeJS.Timeout;
  private corriendo = false;
  private readonly envios = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly linear: LinearClient,
  ) {}

  onModuleInit(): void {
    if (!this.linear.configurado()) {
      this.logger.warn('LINEAR_API_KEY o LINEAR_TEAM_ID sin configurar: las sugerencias quedan pendientes en la base.');
    }
    this.timer = setInterval(() => void this.barrer(), CADA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Valida, aplica el tope diario y guarda. El tope se cuenta en la base (no
   * en memoria, así sobrevive a un reinicio) y bajo un lock por cuenta, para
   * que dos envíos simultáneos no pasen los dos con el último lugar.
   */
  async crear(userId: string, tipo: TipoSugerencia, crudo: string): Promise<void> {
    if (!esTipoSugerencia(tipo)) throw new BadRequestException('Elegí de qué se trata la sugerencia.');
    const validacion = validarSugerencia(crudo);
    if (!validacion.ok) throw new BadRequestException(validacion.error);

    const clave = `sugerencias:${userId}`;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
      const hoy = await tx.sugerenciaMejora.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - UN_DIA_MS) } },
      });
      if (hoy >= MAX_POR_DIA) {
        throw new HttpException(
          `Ya mandaste ${MAX_POR_DIA} sugerencias hoy. Probá de nuevo mañana.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const fila = await tx.sugerenciaMejora.create({
        data: { userId, tipo, texto: validacion.texto },
        select: { id: true },
      });
      return fila.id;
    });

    this.programarEnvio(id);
  }

  /** Para los tests: espera los envíos a Linear que quedaron en curso. */
  async esperar(): Promise<void> {
    await Promise.all(this.envios);
  }

  private programarEnvio(id: string): void {
    const envio = this.enviar(id)
      .catch((error: unknown) => this.logger.error(`Sugerencia ${id}: falló el envío a Linear: ${resumenDeError(error)}`))
      .finally(() => this.envios.delete(envio));
    this.envios.add(envio);
  }

  /**
   * Manda una pendiente a Linear. Antes la reserva sumándole un intento con
   * un update condicional: si el envío inmediato y el barrido la toman a la
   * vez, sólo uno gana y el issue no se duplica. Si Linear falla, el intento
   * ya quedó contado y la retoma el barrido.
   */
  async enviar(id: string): Promise<void> {
    if (!this.linear.configurado()) return;
    const sugerencia = await this.prisma.sugerenciaMejora.findFirst({
      where: { id, enviadaAt: null, intentos: { lt: MAX_INTENTOS } },
      select: { id: true, userId: true, tipo: true, texto: true, intentos: true },
    });
    if (!sugerencia || !esTipoSugerencia(sugerencia.tipo)) return;
    const intentos = sugerencia.intentos + 1;
    const reserva = await this.prisma.sugerenciaMejora.updateMany({
      where: { id, enviadaAt: null, intentos: sugerencia.intentos },
      data: { intentos },
    });
    if (reserva.count === 0) return;

    let identificador: string;
    try {
      identificador = await this.linear.crearIssue({
        titulo: tituloParaLinear(sugerencia.tipo, sugerencia.texto),
        descripcion: descripcionParaLinear(sugerencia.tipo, sugerencia.texto, sugerencia.userId),
      });
    } catch (error) {
      const detalle = `Sugerencia ${id}: no se pudo crear en Linear (intento ${intentos}): ${resumenDeError(error)}`;
      if (intentos >= MAX_INTENTOS) this.logger.error(`${detalle}. Se deja de reintentar.`);
      else this.logger.warn(detalle);
      return;
    }

    // Si el issue ya se creó y lo que falla es marcarla, el barrido la va a
    // volver a mandar (Linear no tiene idempotencia): queda en el log para
    // borrar el duplicado a mano. Es una caída de la base justo en este punto.
    try {
      await this.prisma.sugerenciaMejora.update({
        where: { id },
        data: { linearIssueId: identificador, enviadaAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Sugerencia ${id}: se creó ${identificador} pero no se pudo marcar como enviada: ${resumenDeError(error)}`);
    }
  }

  /** Reintenta las pendientes, de a pocas y de una a la vez. */
  async barrer(): Promise<void> {
    if (this.corriendo || !this.linear.configurado()) return;
    this.corriendo = true;
    try {
      const pendientes = await this.prisma.sugerenciaMejora.findMany({
        where: { enviadaAt: null, intentos: { lt: MAX_INTENTOS }, createdAt: { lt: new Date(Date.now() - GRACIA_MS) } },
        orderBy: { createdAt: 'asc' },
        take: POR_BARRIDO,
        select: { id: true },
      });
      for (const { id } of pendientes) await this.enviar(id);
    } catch (error) {
      this.logger.error(`Falló el barrido de sugerencias: ${resumenDeError(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
