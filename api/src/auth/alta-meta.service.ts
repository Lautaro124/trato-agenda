import { ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetaWhatsappService, type DatosDeSignup } from '../whatsapp/meta/meta-whatsapp.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { Limitador } from './limitador.js';

/** Altas o ingresos con WhatsApp Business que puede intentar una misma IP por hora (sólo en producción, como las del QR). */
export const MAX_ENTRADAS_META_POR_IP_HORA = 10;
/** Y por número, en cualquier entorno: como el login con contraseña. */
export const MAX_ENTRADAS_META_POR_NUMERO_HORA = 10;
const UNA_HORA_MS = 60 * 60 * 1000;

/**
 * Crear la cuenta (o entrar) con WhatsApp Business por la API oficial.
 * Volver de Embedded Signup con un número que Meta da por verificado en esa
 * WABA prueba que se administra esa WABA, no que se tenga el teléfono: un
 * empleado o una agencia con acceso a la WABA también puede. Por eso:
 *
 * - si el número no tiene cuenta, se crea;
 * - si ya la tiene, sólo se entra si esa cuenta ya estaba conectada a la
 *   misma WABA (es la forma de volver a entrar, o de recuperar el acceso, de
 *   una cuenta creada con WhatsApp Business, que no recibe códigos en su chat
 *   propio). Una cuenta de Google, de QR o de otra WABA no se abre así: se
 *   entra con lo de siempre y se conecta desde Vinculación.
 */
@Injectable()
export class AltaMetaService {
  private readonly logger = new Logger(AltaMetaService.name);
  private readonly porIp = new Limitador(MAX_ENTRADAS_META_POR_IP_HORA, UNA_HORA_MS);
  private readonly porNumero = new Limitador(MAX_ENTRADAS_META_POR_NUMERO_HORA, UNA_HORA_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaWhatsappService,
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async entrar(ip: string, datos: DatosDeSignup): Promise<User> {
    const limitaIp = this.config.get('NODE_ENV', { infer: true }) === 'production';
    if (limitaIp && !this.porIp.permitir(ip)) {
      throw new HttpException('Hubo demasiados intentos: probá en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const numero = await this.meta.verificar(datos);
    if (!this.porNumero.permitir(numero.telefono)) {
      throw new HttpException('Hubo demasiados intentos con ese número: probá en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const existente = await this.prisma.user.findUnique({
      where: { phoneNumber: numero.telefono },
      include: { whatsappMeta: { select: { wabaId: true } } },
    });
    if (existente && existente.whatsappMeta?.wabaId !== numero.wabaId) {
      throw new ConflictException({
        message:
          'Ese número ya tiene una cuenta en Trato. Entrá con tu contraseña o con Google y conectá WhatsApp Business desde Vinculación.',
        motivo: 'cuenta_existente',
      });
    }
    const { user, creado } = existente ? { user: existente, creado: false } : await this.crear(numero.telefono);
    try {
      await this.whatsapp.conectarMeta(user.id, numero);
    } catch (error) {
      // Una cuenta recién creada sin WhatsApp conectado no sirve: no queda a medias.
      if (creado) await this.prisma.user.deleteMany({ where: { id: user.id, googleId: null, passwordHash: null } });
      throw error;
    }
    if (creado) this.logger.log(`Cuenta ${user.id} creada con WhatsApp Business.`);
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  }

  /** Dos altas simultáneas del mismo número: la segunda entra a la que creó la primera. */
  private async crear(telefono: string): Promise<{ user: User; creado: boolean }> {
    try {
      return { user: await this.prisma.user.create({ data: { calendario: 'local', phoneNumber: telefono } }), creado: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { user: await this.prisma.user.findUniqueOrThrow({ where: { phoneNumber: telefono } }), creado: false };
      }
      throw error;
    }
  }
}
