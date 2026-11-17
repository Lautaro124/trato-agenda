import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptToken, encryptToken } from '../../auth/token-crypto.js';
import type { Env } from '../../config/env.js';
import { avisoWhatsappMetaDesconectado } from '../../notificaciones/avisos.js';
import { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RENOVAR_ESCRIBIENDO_MS } from '../ritmo-humano.js';
import type { Salida } from '../salida.js';
import { MetaGraphClient, MetaGraphError } from './meta-graph.client.js';
import { waIdDeJid } from './meta-webhook.js';

/** Lo que vuelve del popup de Embedded Signup. Los ids los manda el navegador: se verifican contra Meta. */
export type DatosDeSignup = { code: string; wabaId: string; phoneNumberId: string; coexistencia: boolean };

/** Un número verificado contra Meta, todavía sin guardar. */
export type NumeroVerificado = {
  token: string;
  wabaId: string;
  phoneNumberId: string;
  telefono: string;
  coexistencia: boolean;
};

/** Una conexión guardada, con el token ya descifrado (sólo en memoria). */
export type ConexionMeta = {
  userId: string;
  wabaId: string;
  phoneNumberId: string;
  telefono: string;
  token: string;
};

/**
 * Conexión de WhatsApp Business por la Cloud API oficial: verificar lo que
 * vuelve de Embedded Signup, guardar el token cifrado, y armar la `Salida`
 * por la que contesta el asistente. Las conexiones viven en memoria después
 * de la primera lectura: la API corre en una sola réplica.
 */
@Injectable()
export class MetaWhatsappService {
  private readonly logger = new Logger(MetaWhatsappService.name);
  /** userId → conexión (o null si no tiene). */
  private readonly porUsuario = new Map<string, ConexionMeta | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly graph: MetaGraphClient,
    private readonly notificaciones: NotificacionesService,
  ) {}

  get configurado(): boolean {
    return this.graph.configurado;
  }

  private exigirConfigurado(): void {
    if (!this.configurado) throw new NotFoundException();
  }

  private clave(): string {
    return this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });
  }

  /**
   * Canjea el código y confirma que el número es de esa WABA y que el token
   * la ve: recién ahí se sabe que quien volvió del popup controla el número.
   * No guarda nada ni tiene efectos en Meta.
   */
  async verificar(datos: DatosDeSignup): Promise<NumeroVerificado> {
    this.exigirConfigurado();
    try {
      const token = await this.graph.canjearCodigo(datos.code);
      const numero = await this.graph.numeroDeWaba(token, datos.wabaId, datos.phoneNumberId);
      if (!numero) throw new BadRequestException('Ese número no es de la cuenta de WhatsApp Business que conectaste.');
      return { token, wabaId: datos.wabaId, phoneNumberId: numero.id, telefono: numero.telefono, coexistencia: datos.coexistencia };
    } catch (error) {
      if (!(error instanceof MetaGraphError)) throw error;
      this.logger.warn(`No se pudo verificar un alta de WhatsApp Business: ${error.message}`);
      // Un código vencido o ya usado es un 400 de Meta: se puede reintentar el popup.
      throw new BadGatewayException('Meta no confirmó la conexión. Probá de nuevo.');
    }
  }

  /**
   * Deja el número conectado a `userId`: suscribe la app a la WABA, registra
   * el número (o pide la sincronización de la coexistencia) y guarda el token
   * cifrado. `User.phoneNumber` pasa a ser este número; si es de otra cuenta,
   * 409 sin efectos en Meta. Quien llama cierra antes la sesión de Baileys.
   */
  async activar(userId: string, numero: NumeroVerificado): Promise<void> {
    this.exigirConfigurado();
    await this.exigirNumeroLibre(userId, numero);

    try {
      await this.graph.suscribirApp(numero.token, numero.wabaId);
      if (numero.coexistencia) await this.graph.iniciarSincronizacion(numero.token, numero.phoneNumberId);
      else await this.graph.registrarNumero(numero.token, numero.phoneNumberId);
    } catch (error) {
      if (!(error instanceof MetaGraphError)) throw error;
      this.logger.warn(`No se pudo activar WhatsApp Business de ${userId}: ${error.message}`);
      throw new BadGatewayException('Meta no dejó activar el número. Probá de nuevo en un rato.');
    }

    const datos = {
      wabaId: numero.wabaId,
      phoneNumberId: numero.phoneNumberId,
      phoneNumber: numero.telefono,
      accessToken: encryptToken(numero.token, this.clave()),
      coexistencia: numero.coexistencia,
      conectadoAt: new Date(),
    };
    await this.prisma.$transaction([
      this.prisma.whatsappMeta.upsert({ where: { userId }, create: { userId, ...datos }, update: datos }),
      this.prisma.user.update({ where: { id: userId }, data: { phoneNumber: numero.telefono } }),
    ]);
    this.porUsuario.set(userId, {
      userId,
      wabaId: numero.wabaId,
      phoneNumberId: numero.phoneNumberId,
      telefono: numero.telefono,
      token: numero.token,
    });
    this.logger.log(`WhatsApp Business conectado por la Cloud API para ${userId}.`);
  }

  /** 409 si el número (o su phone_number_id) ya es de otra cuenta de Trato. */
  private async exigirNumeroLibre(userId: string, numero: NumeroVerificado): Promise<void> {
    const [dueno, otroMeta] = await Promise.all([
      this.prisma.user.findUnique({ where: { phoneNumber: numero.telefono }, select: { id: true } }),
      this.prisma.whatsappMeta.findUnique({ where: { phoneNumberId: numero.phoneNumberId }, select: { userId: true } }),
    ]);
    if ((dueno && dueno.id !== userId) || (otroMeta && otroMeta.userId !== userId)) {
      throw new ConflictException({ message: 'Ese WhatsApp ya es de otra cuenta de Trato.', motivo: 'numero_en_uso' });
    }
  }

  /** Saca la app de la WABA (si Meta responde) y borra el token. El número sigue siendo la identidad de la cuenta. */
  async desconectar(userId: string): Promise<void> {
    const conexion = await this.conexionDe(userId);
    if (!conexion) return;
    await this.graph.desuscribirApp(conexion.token, conexion.wabaId).catch((error: unknown) =>
      this.logger.warn(`No se pudo desuscribir la app de la WABA de ${userId}: ${(error as Error).message}`),
    );
    await this.prisma.whatsappMeta.deleteMany({ where: { userId } });
    this.porUsuario.set(userId, null);
  }

  /** El negocio sacó a Trato de su WABA desde Meta: se borra la conexión y se le avisa en el panel. */
  async darDeBaja(wabaId: string): Promise<void> {
    const filas = await this.prisma.whatsappMeta.findMany({ where: { wabaId }, select: { userId: true } });
    for (const { userId } of filas) {
      await this.prisma.whatsappMeta.deleteMany({ where: { userId, wabaId } });
      this.porUsuario.set(userId, null);
      this.logger.warn(`WhatsApp Business de ${userId} desconectado desde Meta.`);
      await this.notificaciones
        .avisar(userId, avisoWhatsappMetaDesconectado())
        .catch((error: unknown) => this.logger.warn(`No se pudo avisar la baja de ${userId}: ${(error as Error).message}`));
    }
  }

  async conexionDe(userId: string): Promise<ConexionMeta | null> {
    if (this.porUsuario.has(userId)) return this.porUsuario.get(userId)!;
    const fila = await this.prisma.whatsappMeta.findUnique({ where: { userId } });
    const conexion = fila ? this.aConexion(fila) : null;
    this.porUsuario.set(userId, conexion);
    return conexion;
  }

  async conexionPorNumero(phoneNumberId: string): Promise<ConexionMeta | null> {
    const fila = await this.prisma.whatsappMeta.findUnique({ where: { phoneNumberId }, select: { userId: true } });
    const conexion = fila ? await this.conexionDe(fila.userId) : null;
    return conexion?.phoneNumberId === phoneNumberId ? conexion : null;
  }

  private aConexion(fila: { userId: string; wabaId: string; phoneNumberId: string; phoneNumber: string; accessToken: string }): ConexionMeta {
    return {
      userId: fila.userId,
      wabaId: fila.wabaId,
      phoneNumberId: fila.phoneNumberId,
      telefono: fila.phoneNumber,
      token: decryptToken(fila.accessToken, this.clave()),
    };
  }

  /**
   * Por dónde contestar. Con `mensajeId` (el último del cliente) se puede
   * mostrar "escribiendo…": en la Cloud API va atado a marcar ese mensaje leído.
   */
  salida(conexion: ConexionMeta, mensajeId?: string): Salida {
    const para = (remoteJid: string) => {
      const waId = waIdDeJid(remoteJid);
      if (!waId) throw new Error('El chat no es de un número de WhatsApp.');
      return waId;
    };
    return {
      canal: 'meta',
      ventana24h: true,
      // async: un chat inválido tiene que ser un rechazo, no una excepción que se saltee el `.catch` de quien llama.
      enviarTexto: async (remoteJid, texto) => this.graph.enviarTexto(conexion.token, conexion.phoneNumberId, para(remoteJid), texto),
      enviarImagen: async (remoteJid, jpeg, leyenda) =>
        this.graph.enviarImagen(conexion.token, conexion.phoneNumberId, para(remoteJid), jpeg, leyenda),
      escribiendo: () => {
        if (!mensajeId) return { renovar: () => undefined, parar: () => undefined };
        const avisar = () =>
          void this.graph.leidoYEscribiendo(conexion.token, conexion.phoneNumberId, mensajeId, true).catch(() => undefined);
        avisar();
        // Meta lo apaga solo a los 25 s: se renueva igual que con Baileys.
        const intervalo = setInterval(avisar, RENOVAR_ESCRIBIENDO_MS);
        return { renovar: avisar, parar: () => clearInterval(intervalo) };
      },
      vigente: () => this.porUsuario.get(conexion.userId)?.phoneNumberId === conexion.phoneNumberId,
    };
  }

  marcarLeido(conexion: ConexionMeta, mensajeId: string): Promise<void> {
    return this.graph.leidoYEscribiendo(conexion.token, conexion.phoneNumberId, mensajeId, false);
  }

  /** Un audio o una imagen de un cliente, con tope de bytes y de tiempo. null si pesa de más. */
  async descargarMedia(conexion: ConexionMeta, mediaId: string, maxBytes: number, plazoMs: number): Promise<Buffer | null> {
    const media = await this.graph.media(conexion.token, mediaId);
    if (media.bytes !== null && media.bytes > maxBytes) return null;
    return this.graph.descargar(conexion.token, media.url, maxBytes, plazoMs);
  }
}
