import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type User } from '../generated/prisma/client.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { codigoCorrecto, generarCodigo, hashDe, MAX_INTENTOS_POR_CODIGO, MINUTOS_VIGENCIA_CODIGO } from './codigo-acceso.service.js';
import { Limitador } from './limitador.js';
import { passwordCorrecta } from './password.js';

const UN_MINUTO_MS = 60 * 1000;
const UNA_HORA_MS = 60 * UN_MINUTO_MS;

const RECHAZO = 'El código no es válido o venció. Pedí uno nuevo.';

/** El email como se compara y se guarda: sin espacios y en minúsculas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDeVerificacion(codigo: string): { asunto: string; texto: string } {
  return {
    asunto: 'Confirmá tu email en Trato',
    texto:
      `Tu código para confirmar este email en Trato es ${codigo}. ` +
      `Vence en ${MINUTOS_VIGENCIA_CODIGO} minutos.\n\n` +
      'Con este email vas a poder recuperar el acceso a tu cuenta aunque WhatsApp esté desconectado. ' +
      'Si no fuiste vos, ignorá este mensaje: no se suma a ninguna cuenta hasta que alguien escriba el código.',
  };
}

/**
 * El email de recuperación de una cuenta (LAU-109): la forma de volver a
 * entrar que no depende de la sesión de Baileys. Sólo queda guardado después
 * de que el titular escribe el código que le llegó ahí, así que nunca se
 * marca como verificado sin prueba.
 *
 * Contra la apropiación de cuentas: sumarlo o cambiarlo pide la contraseña
 * actual (una sesión robada sola no alcanza para redirigir la recuperación),
 * el código vence a los 10 minutos con 5 intentos, y al cambiarlo se le avisa
 * a la dirección anterior.
 */
@Injectable()
export class EmailRecuperacionService {
  private readonly pedidosPorCuentaMinuto = new Limitador(1, UN_MINUTO_MS);
  private readonly pedidosPorCuentaHora = new Limitador(5, UNA_HORA_MS);
  private readonly verificacionesPorCuenta = new Limitador(20, UNA_HORA_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailService,
  ) {}

  disponible(): boolean {
    return this.emails.disponible();
  }

  async solicitar(user: User, email: string, password: string): Promise<void> {
    if (!user.passwordHash) {
      throw new BadRequestException('Elegí una contraseña antes de sumar un email.');
    }
    if (!(await passwordCorrecta(password, user.passwordHash))) {
      // 403 y no 401: la sesión es válida, lo que falla es la contraseña.
      throw new ForbiddenException('La contraseña actual no es correcta.');
    }
    if (!this.emails.disponible()) {
      throw new ServiceUnavailableException('Todavía no podemos mandar emails. Probá más tarde.');
    }
    const destino = normalizarEmail(email);
    if (destino === user.emailRecuperacion) {
      throw new BadRequestException('Ese ya es tu email de recuperación.');
    }
    if (!this.pedidosPorCuentaMinuto.permitir(user.id) || !this.pedidosPorCuentaHora.permitir(user.id)) {
      throw new HttpException('Esperá un momento antes de pedir otro código.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const codigo = generarCodigo();
    const datos = {
      email: destino,
      hash: hashDe(codigo),
      expiraAt: new Date(Date.now() + MINUTOS_VIGENCIA_CODIGO * UN_MINUTO_MS),
      intentos: 0,
    };
    await this.prisma.verificacionEmail.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...datos },
      update: { ...datos, createdAt: new Date() },
    });

    const enviado = await this.emails.enviar({ para: destino, ...emailDeVerificacion(codigo) });
    if (!enviado) {
      await this.prisma.verificacionEmail.deleteMany({ where: { userId: user.id } });
      throw new ServiceUnavailableException('No pudimos mandar el email. Revisá la dirección o probá más tarde.');
    }
  }

  async confirmar(user: User, codigo: string): Promise<User> {
    if (!this.verificacionesPorCuenta.permitir(user.id)) {
      throw new HttpException('Demasiados intentos: probá más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const pendiente = await this.prisma.verificacionEmail.findUnique({ where: { userId: user.id } });
    if (!pendiente) throw new UnauthorizedException(RECHAZO);

    if (pendiente.expiraAt <= new Date() || pendiente.intentos >= MAX_INTENTOS_POR_CODIGO) {
      await this.prisma.verificacionEmail.deleteMany({ where: { userId: user.id } });
      throw new UnauthorizedException(RECHAZO);
    }
    if (!codigoCorrecto(codigo, pendiente.hash)) {
      await this.prisma.verificacionEmail.update({ where: { id: pendiente.id }, data: { intentos: { increment: 1 } } });
      throw new UnauthorizedException(RECHAZO);
    }

    const anterior = user.emailRecuperacion;
    let actualizado: User;
    try {
      [actualizado] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: { emailRecuperacion: pendiente.email, emailVerificadoAt: new Date() },
        }),
        this.prisma.verificacionEmail.delete({ where: { id: pendiente.id } }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Ya probó que el email es suyo: decirle que está en otra cuenta no filtra nada nuevo.
        await this.prisma.verificacionEmail.deleteMany({ where: { userId: user.id } });
        throw new ConflictException('Ese email ya es el de recuperación de otra cuenta de Trato.');
      }
      throw error;
    }

    if (anterior && anterior !== pendiente.email) {
      void this.emails.enviar({
        para: anterior,
        asunto: 'Cambió el email de recuperación de tu cuenta de Trato',
        texto:
          'El email de recuperación de tu cuenta de Trato se cambió por otro, así que los códigos de acceso ya no llegan acá. ' +
          'Si no fuiste vos, entrá a Trato, cambiá tu contraseña y escribinos a soporte.',
      });
    }
    return actualizado;
  }

  /** Aviso, best effort, de que la contraseña de la cuenta cambió: la forma de notar una apropiación. */
  avisarCambioDePassword(user: Pick<User, 'emailRecuperacion'>): void {
    if (!user.emailRecuperacion) return;
    void this.emails.enviar({
      para: user.emailRecuperacion,
      asunto: 'Cambió la contraseña de tu cuenta de Trato',
      texto:
        'La contraseña de tu cuenta de Trato se acaba de cambiar y se cerraron las demás sesiones. ' +
        'Si fuiste vos, no tenés que hacer nada. Si no, recuperá el acceso desde "¿Olvidaste tu contraseña?" en Trato ' +
        'y escribinos a soporte.',
    });
  }
}
