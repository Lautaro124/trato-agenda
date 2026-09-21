import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { Limitador } from './limitador.js';
import { buscarUsuarioPorTelefono, claveDeTelefono } from './telefono.js';

export const MINUTOS_VIGENCIA_CODIGO = 10;
export const MAX_INTENTOS_POR_CODIGO = 5;

const UN_MINUTO_MS = 60 * 1000;
const UNA_HORA_MS = 60 * UN_MINUTO_MS;

const RECHAZO = 'El código no es válido o venció. Pedí uno nuevo.';

function hashDe(codigo: string): string {
  return createHash('sha256').update(codigo).digest('hex');
}

export function codigoCorrecto(recibido: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashDe(recibido), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mensajeConCodigo(codigo: string): string {
  return (
    `Tu código para entrar a Trato Agenda es ${codigo}. ` +
    `Vence en ${MINUTOS_VIGENCIA_CODIGO} minutos. Si no lo pediste, ignorá este mensaje.`
  );
}

/**
 * Volver a entrar al panel con una cuenta de WhatsApp: el código se manda al
 * chat propio del titular ("Vos") por la misma sesión de Baileys que atiende
 * a sus clientes, así que recibirlo prueba que se tiene ese WhatsApp.
 *
 * Nunca revela si un número tiene cuenta: pedir un código contesta igual en
 * los dos casos. Se guarda sólo el hash, vence a los 10 minutos, admite 5
 * intentos y se consume al usarse. Los límites por número y por IP acotan la
 * fuerza bruta a unas pocas centenas de intentos por día sobre un millón.
 */
@Injectable()
export class CodigoAccesoService {
  private readonly logger = new Logger(CodigoAccesoService.name);
  private readonly pedidosPorTelefono = new Limitador(1, UN_MINUTO_MS);
  private readonly pedidosPorIp = new Limitador(10, UNA_HORA_MS);
  private readonly verificacionesPorTelefono = new Limitador(20, UNA_HORA_MS);
  /** Sólo fuera de producción: el último código por número, para el login dev y los E2E. */
  private readonly ultimosDev = new Map<string, string>();
  /** Última generación en curso; sólo la esperan los specs. */
  pendiente: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private enProduccion(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /**
   * Contesta apenas pasan los límites y genera el código en segundo plano: si
   * esperara a la base y a WhatsApp, un número sin cuenta respondería más
   * rápido que uno con cuenta, y el tiempo delataría lo que el 202 esconde.
   */
  solicitar(telefono: string, ip: string): void {
    // Por IP sólo en producción: los E2E salen todos de localhost. Por número, siempre.
    const limitaIp = this.enProduccion();
    // Por la clave y no por el número tipeado: las distintas formas de
    // escribir el mismo número comparten el límite.
    if ((limitaIp && !this.pedidosPorIp.permitir(ip)) || !this.pedidosPorTelefono.permitir(claveDeTelefono(telefono))) {
      throw new HttpException('Esperá un momento antes de pedir otro código.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.pendiente = this.generarYEnviar(telefono).catch((error: unknown) =>
      this.logger.error(`Falló el envío de un código de acceso: ${(error as Error).message}`),
    );
  }

  private async generarYEnviar(telefono: string): Promise<void> {
    const user = await buscarUsuarioPorTelefono(this.prisma, telefono);
    if (!user) return;

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.codigoAcceso.deleteMany({ where: { userId: user.id } });
    await this.prisma.codigoAcceso.create({
      data: {
        userId: user.id,
        hash: hashDe(codigo),
        expiraAt: new Date(Date.now() + MINUTOS_VIGENCIA_CODIGO * UN_MINUTO_MS),
      },
    });

    const enviado = await this.whatsapp.enviarAlPropioChat(user.id, mensajeConCodigo(codigo)).catch((error: unknown) => {
      this.logger.warn(`No se pudo mandar el código a ${user.id}: ${(error as Error).message}`);
      return false;
    });
    if (enviado) return;

    if (!this.enProduccion()) {
      // Sin socket (login dev, E2E): el código queda a mano para /auth/dev/ultimo-codigo.
      this.ultimosDev.set(claveDeTelefono(telefono), codigo);
      this.logger.debug(`Código de acceso dev para ${telefono}: ${codigo}`);
      return;
    }
    // Sin WhatsApp conectado el código no le llega a nadie: no tiene sentido guardarlo.
    await this.prisma.codigoAcceso.deleteMany({ where: { userId: user.id } });
  }

  async verificar(telefono: string, codigo: string): Promise<User> {
    if (!this.verificacionesPorTelefono.permitir(claveDeTelefono(telefono))) {
      throw new HttpException('Demasiados intentos: probá más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await buscarUsuarioPorTelefono(this.prisma, telefono);
    const guardado = user
      ? await this.prisma.codigoAcceso.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
      : null;
    if (!user || !guardado) throw new UnauthorizedException(RECHAZO);

    if (guardado.expiraAt <= new Date() || guardado.intentos >= MAX_INTENTOS_POR_CODIGO) {
      await this.prisma.codigoAcceso.deleteMany({ where: { userId: user.id } });
      throw new UnauthorizedException(RECHAZO);
    }

    if (!codigoCorrecto(codigo, guardado.hash)) {
      await this.prisma.codigoAcceso.update({ where: { id: guardado.id }, data: { intentos: { increment: 1 } } });
      throw new UnauthorizedException(RECHAZO);
    }

    await this.prisma.codigoAcceso.deleteMany({ where: { userId: user.id } });
    this.ultimosDev.delete(claveDeTelefono(telefono));
    return user;
  }

  /** Nunca en producción: lo expone DevAuthController, que ahí ni se registra. */
  ultimoCodigoDev(telefono: string): string | null {
    if (this.enProduccion()) return null;
    return this.ultimosDev.get(claveDeTelefono(telefono)) ?? null;
  }
}
