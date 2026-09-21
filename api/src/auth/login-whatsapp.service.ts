import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Limitador } from './limitador.js';
import { HASH_FALSO, hashearPassword, passwordCorrecta } from './password.js';
import { buscarUsuarioPorTelefono, claveDeTelefono } from './telefono.js';

const QUINCE_MINUTOS_MS = 15 * 60 * 1000;
const UNA_HORA_MS = 60 * 60 * 1000;

export const MAX_INTENTOS_POR_NUMERO = 10;
export const MAX_INTENTOS_POR_IP = 30;

const RECHAZO = 'El número o la contraseña no son correctos.';

/**
 * Entrar con número de WhatsApp + contraseña, y poner o cambiar esa
 * contraseña. Siempre el mismo 401, y siempre se corre scrypt (contra
 * `HASH_FALSO` si no hay cuenta o no tiene contraseña): ni el mensaje ni el
 * tiempo dicen qué números existen.
 */
@Injectable()
export class LoginWhatsappService {
  private readonly porNumero = new Limitador(MAX_INTENTOS_POR_NUMERO, QUINCE_MINUTOS_MS);
  private readonly porIp = new Limitador(MAX_INTENTOS_POR_IP, UNA_HORA_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async entrar(telefono: string, password: string, ip: string): Promise<User> {
    // Por IP sólo en producción: los E2E salen todos de localhost. Por número, siempre.
    const limitaIp = this.config.get('NODE_ENV', { infer: true }) === 'production';
    // La clave y no el número tipeado: las formas de escribir el mismo número
    // comparten los intentos, si no el límite se multiplica por cada una.
    if ((limitaIp && !this.porIp.permitir(ip)) || !this.porNumero.permitir(claveDeTelefono(telefono))) {
      throw new HttpException('Demasiados intentos: probá en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await buscarUsuarioPorTelefono(this.prisma, telefono);
    const correcta = await passwordCorrecta(password, user?.passwordHash ?? HASH_FALSO);
    if (!user || !user.passwordHash || !correcta) throw new UnauthorizedException(RECHAZO);
    return user;
  }

  /**
   * Poner (si no tiene) o cambiar (con la actual) la contraseña de una cuenta
   * con WhatsApp. Sin la actual se acepta sólo cuando todavía no hay ninguna:
   * es el paso que sigue al QR del alta.
   */
  async cambiarPassword(user: User, nueva: string, actual?: string): Promise<void> {
    if (!user.phoneNumber) {
      throw new BadRequestException('La contraseña es para entrar con WhatsApp, y esta cuenta no tiene uno vinculado.');
    }
    if (user.passwordHash && !(actual && (await passwordCorrecta(actual, user.passwordHash)))) {
      // 403 y no 401: la sesión es válida, lo que falla es la contraseña.
      throw new ForbiddenException('La contraseña actual no es correcta.');
    }
    await this.guardar(user.id, nueva);
  }

  async guardar(userId: string, nueva: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashearPassword(nueva) } });
  }
}
