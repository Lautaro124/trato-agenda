import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type MessageEvent,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMPTY, type Observable } from 'rxjs';
import { decryptToken, encryptToken } from '../../auth/token-crypto.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { idDeWhatsapp, resolverChat } from '../proveedor/contacto.js';
import type {
  ContenidoEntrante,
  ContenidoSaliente,
  EntranteCanal,
  MediaEntrante,
  ProveedorWhatsapp,
  ReceptorCanal,
  SesionCanal,
} from '../proveedor/proveedor.js';
import type { WhatsappStatus } from '../whatsapp.types.js';
import { ErrorDeGraph, GraphClient } from './graph.client.js';
import { esIdDeMeta, type ContenidoCloud, type EventoCloud } from './webhook.js';

/** Ids de lo que mandó Trato que se recuerdan por cuenta, para reconocer su eco. */
const MAX_ENVIADOS_RECORDADOS = 500;
/** El "escribiendo…" de la Cloud API dura hasta 25 s: no se pide más seguido que esto. */
const RENOVAR_ESCRIBIENDO_MS = 20_000;

/** Lo que manda el navegador al terminar Embedded Signup. */
export type AltaCloud = {
  codigo: string;
  wabaId: string;
  phoneNumberId: string;
  /** El número sigue en la app WhatsApp Business del celular: no se registra. */
  coexistencia: boolean;
  /** PIN de verificación en dos pasos (6 dígitos), sólo sin Coexistence. */
  pin?: string;
};

/** Un número conectado, ya descifrado. Vive en memoria mientras dura el proceso. */
type CuentaCloud = {
  userId: string;
  wabaId: string;
  phoneNumberId: string;
  telefono: string;
  token: string;
  coexistencia: boolean;
};

/**
 * La API oficial de WhatsApp (Cloud API), con el número conectado por
 * Embedded Signup. No hay socket ni QR: Meta manda lo que llega por webhook y
 * se contesta por HTTP. Las cuentas conectadas se cargan al arrancar y se
 * mantienen en memoria (la API corre con una sola réplica), así
 * `sesionVinculada` es sincrónico como el de Baileys.
 */
@Injectable()
export class CloudProveedor implements ProveedorWhatsapp, OnModuleInit {
  readonly id = 'cloud' as const;
  private readonly logger = new Logger(CloudProveedor.name);
  private receptor: ReceptorCanal | undefined;
  private readonly porUsuario = new Map<string, CuentaCloud>();
  private readonly porNumero = new Map<string, CuentaCloud>();
  private readonly sesiones = new WeakMap<CuentaCloud, SesionCloud>();
  private readonly altasEnCurso = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly graph: GraphClient,
  ) {}

  get configurado(): boolean {
    return this.graph.configurado;
  }

  async onModuleInit(): Promise<void> {
    const filas = await this.prisma.cuentaWhatsappCloud.findMany().catch((error: unknown) => {
      this.logger.error(`No se pudieron cargar los números de la API oficial: ${(error as Error).name}`);
      return [];
    });
    for (const fila of filas) {
      try {
        this.recordar({ ...fila, token: decryptToken(fila.tokenCifrado, this.clave()) });
      } catch {
        this.logger.error(`No se pudo descifrar el token de la API oficial de ${fila.userId}.`);
      }
    }
  }

  private clave(): string {
    return this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });
  }

  private recordar(cuenta: CuentaCloud): void {
    this.olvidar(cuenta.userId);
    this.porUsuario.set(cuenta.userId, cuenta);
    this.porNumero.set(cuenta.phoneNumberId, cuenta);
  }

  private olvidar(userId: string): void {
    const previa = this.porUsuario.get(userId);
    if (!previa) return;
    this.porUsuario.delete(userId);
    if (this.porNumero.get(previa.phoneNumberId) === previa) this.porNumero.delete(previa.phoneNumberId);
  }

  /** Si `cuenta` sigue siendo la conexión del comercio (no se desconectó ni la reemplazó otra). */
  vigente(cuenta: CuentaCloud): boolean {
    return this.porUsuario.get(cuenta.userId) === cuenta;
  }

  escuchar(receptor: ReceptorCanal): void {
    this.receptor = receptor;
  }

  sesionVinculada(userId: string): SesionCanal | null {
    const cuenta = this.porUsuario.get(userId);
    return cuenta ? this.sesionDe(cuenta) : null;
  }

  private sesionDe(cuenta: CuentaCloud): SesionCloud {
    let sesion = this.sesiones.get(cuenta);
    if (!sesion) {
      sesion = new SesionCloud(cuenta, this, this.graph, this.prisma);
      this.sesiones.set(cuenta, sesion);
    }
    return sesion;
  }

  status(userId: string): Promise<WhatsappStatus> {
    const cuenta = this.porUsuario.get(userId);
    return Promise.resolve({ linked: Boolean(cuenta), phoneNumber: cuenta?.telefono ?? null });
  }

  /** La vinculación oficial es el popup de Meta, no un stream: no hay eventos que mandar. */
  linkEvents$(): Observable<MessageEvent> {
    return EMPTY;
  }

  /**
   * Conecta el número que el comercio eligió en Embedded Signup. Nada de lo
   * que manda el navegador se cree: el código se canjea acá y el número tiene
   * que estar en la WABA que ve ese token. El número no puede ser de otra
   * cuenta de Trato.
   */
  async conectar(userId: string, alta: AltaCloud): Promise<WhatsappStatus> {
    if (!this.configurado) throw new ServiceUnavailableException('La conexión oficial de WhatsApp todavía no está disponible.');
    if (!esIdDeMeta(alta.wabaId) || !esIdDeMeta(alta.phoneNumberId)) {
      throw new BadRequestException('Los datos de WhatsApp no son válidos.');
    }
    if (!alta.coexistencia && !/^\d{6}$/.test(alta.pin ?? '')) {
      throw new BadRequestException('Ingresá el PIN de 6 dígitos de la verificación en dos pasos del número.');
    }
    if (this.altasEnCurso.has(userId)) throw new ConflictException('Ya estamos conectando tu WhatsApp: esperá un momento.');
    this.altasEnCurso.add(userId);
    try {
      return await this.conectarSinPisarse(userId, alta);
    } finally {
      this.altasEnCurso.delete(userId);
    }
  }

  private async conectarSinPisarse(userId: string, alta: AltaCloud): Promise<WhatsappStatus> {
    const token = await this.graph.canjearCodigo(alta.codigo).catch((error: unknown) => {
      this.logger.warn(`No se pudo canjear el código de Embedded Signup de ${userId}: ${(error as Error).message}`);
      throw new BadRequestException('Meta no aceptó la conexión: probá de nuevo desde el principio.');
    });
    const numeros = await this.graph.numerosDeWaba(alta.wabaId, token).catch((error: unknown) => {
      this.logger.warn(`No se pudieron leer los números de la WABA de ${userId}: ${(error as Error).message}`);
      throw new BadRequestException('No pudimos leer tu cuenta de WhatsApp Business: probá de nuevo.');
    });
    const numero = numeros.find((candidato) => candidato.id === alta.phoneNumberId);
    const telefono = idDeWhatsapp(numero?.telefono);
    if (!numero || !telefono) throw new BadRequestException('Ese número no está en tu cuenta de WhatsApp Business.');

    const [dueno, ocupado] = await Promise.all([
      this.prisma.user.findUnique({ where: { phoneNumber: telefono }, select: { id: true } }),
      this.prisma.cuentaWhatsappCloud.findUnique({ where: { phoneNumberId: alta.phoneNumberId }, select: { userId: true } }),
    ]);
    if ((dueno && dueno.id !== userId) || (ocupado && ocupado.userId !== userId)) {
      throw new ConflictException({ message: 'Ese WhatsApp ya es la cuenta de otra persona en Trato.', motivo: 'numero_en_uso' });
    }

    try {
      if (!alta.coexistencia) await this.graph.registrar(alta.phoneNumberId, token, alta.pin!);
      await this.graph.suscribir(alta.wabaId, token);
    } catch (error) {
      this.logger.warn(`No se pudo dejar listo el número de la API oficial de ${userId}: ${(error as Error).message}`);
      throw new BadRequestException(
        alta.coexistencia
          ? 'Meta no terminó de conectar el número: probá de nuevo en unos minutos.'
          : 'Meta no aceptó el número. Revisá el PIN de la verificación en dos pasos y probá de nuevo.',
      );
    }

    const datos = {
      wabaId: alta.wabaId,
      phoneNumberId: alta.phoneNumberId,
      telefono,
      tokenCifrado: encryptToken(token, this.clave()),
      coexistencia: alta.coexistencia,
    };
    try {
      await this.prisma.$transaction([
        this.prisma.cuentaWhatsappCloud.upsert({ where: { userId }, create: { userId, ...datos }, update: datos }),
        this.prisma.user.update({ where: { id: userId }, data: { phoneNumber: telefono } }),
      ]);
    } catch (error) {
      // Otra cuenta se quedó con el número entre la consulta y la escritura.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException({ message: 'Ese WhatsApp ya es la cuenta de otra persona en Trato.', motivo: 'numero_en_uso' });
      }
      throw error;
    }
    this.receptor?.sesionCerrada(userId);
    this.recordar({ userId, wabaId: alta.wabaId, phoneNumberId: alta.phoneNumberId, telefono, token, coexistencia: alta.coexistencia });
    this.receptor?.fallo(userId, this.id, null);
    return this.status(userId);
  }

  /**
   * Desconecta el número de Trato: deja de recibir sus webhooks y borra el
   * token. El número sigue en Meta (y, con Coexistence, en el celular).
   */
  async unlink(userId: string): Promise<void> {
    const cuenta = this.porUsuario.get(userId);
    this.receptor?.sesionCerrada(userId);
    this.olvidar(userId);
    await this.prisma.cuentaWhatsappCloud.deleteMany({ where: { userId } });
    if (!cuenta) return;
    // La suscripción es de toda la WABA: si otro comercio tiene un número en ella, sigue recibiendo.
    const compartida = await this.prisma.cuentaWhatsappCloud
      .count({ where: { wabaId: cuenta.wabaId } })
      .then((otras) => otras > 0)
      .catch(() => true);
    if (compartida) return;
    await this.graph.desuscribir(cuenta.wabaId, cuenta.token).catch((error: unknown) =>
      this.logger.warn(`No se pudo dar de baja el webhook de ${userId}: ${(error as Error).message}`),
    );
  }

  /** La Cloud API no puede escribirle al propio número: los códigos de acceso no salen por acá. */
  enviarAlPropioChat(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Los chats de la API oficial ya son el número del cliente. */
  telefonoDeChat(): Promise<string | null> {
    return Promise.resolve(null);
  }

  /** El token dejó de servir: el dueño tiene que volver a conectar. */
  tokenRechazado(cuenta: CuentaCloud): void {
    if (this.vigente(cuenta)) this.receptor?.fallo(cuenta.userId, this.id, 'volver_a_vincular');
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Lo que llegó por el webhook (con la firma ya verificada). Cada comercio
   * recibe su lote, en el orden en que vino; lo de un número que no está
   * conectado se ignora.
   */
  async recibirWebhook(eventos: EventoCloud[]): Promise<void> {
    const porCuenta = new Map<CuentaCloud, EntranteCanal[]>();
    for (const evento of eventos) {
      if (evento.tipo === 'desconectado') {
        await this.desconectadoDesdeMeta(evento.wabaId);
        continue;
      }
      const cuenta = this.porNumero.get(evento.phoneNumberId);
      if (!cuenta) continue;
      const entrante = await this.aEntrante(cuenta, evento).catch((error: unknown) => {
        this.logger.warn(`No se pudo leer un mensaje de la API oficial de ${cuenta.userId}: ${(error as Error).name}`);
        return null;
      });
      if (!entrante) continue;
      const lote = porCuenta.get(cuenta) ?? [];
      lote.push(entrante);
      porCuenta.set(cuenta, lote);
    }
    const receptor = this.receptor;
    if (!receptor) return;
    await Promise.all([...porCuenta.values()].map((lote) => receptor.recibir(lote)));
  }

  /**
   * El comercio quitó a Trato desde Meta o desde la app: se borra lo guardado y se le avisa.
   * La baja es de toda la WABA (Trato pierde acceso a todos sus números), así que alcanza a
   * cada cuenta conectada con un número de ella.
   */
  private async desconectadoDesdeMeta(wabaId: string): Promise<void> {
    const cuentas = [...this.porUsuario.values()].filter((cuenta) => cuenta.wabaId === wabaId);
    for (const cuenta of cuentas) {
      this.receptor?.sesionCerrada(cuenta.userId);
      this.receptor?.fallo(cuenta.userId, this.id, 'volver_a_vincular');
      this.olvidar(cuenta.userId);
      await this.prisma.cuentaWhatsappCloud.deleteMany({ where: { userId: cuenta.userId, wabaId } });
      this.logger.warn(`El comercio ${cuenta.userId} desconectó a Trato de su WhatsApp Business.`);
    }
  }

  private async aEntrante(cuenta: CuentaCloud, evento: Exclude<EventoCloud, { tipo: 'desconectado' }>): Promise<EntranteCanal | null> {
    const deMi = evento.tipo === 'eco';
    const resolucion = await resolverChat(this.prisma, cuenta.userId, deMi ? evento.para : evento.de);
    if (resolucion.tipo === 'ambiguo' || resolucion.tipo === 'invalido') {
      this.logger.warn(`Mensaje de la API oficial de ${cuenta.userId} sin chat: ${resolucion.tipo}.`);
      return null;
    }
    const waId = idDeWhatsapp(deMi ? evento.para : evento.de)!;
    // Un chat LID de antes no trae el número en el JID: se guarda aparte, como hace Baileys.
    const telefono = resolucion.chat.endsWith('@lid') ? waId : null;
    const sesion = this.sesionDe(cuenta);
    if (!deMi) sesion.recibido(resolucion.chat, evento.id);
    return {
      sesion,
      chat: resolucion.chat,
      idExterno: evento.id,
      deMi,
      telefono,
      enviadoEn: evento.enviadoEn,
      anuncio: evento.tipo === 'mensaje' && evento.anuncio ? { ...evento.anuncio, miniatura: null } : null,
      contenido:
        evento.tipo === 'eco'
          ? evento.texto
            ? { tipo: 'texto', texto: evento.texto }
            : { tipo: 'otro' }
          : this.contenidoEntrante(cuenta, evento.contenido),
      ref: evento.id,
    };
  }

  private contenidoEntrante(cuenta: CuentaCloud, contenido: ContenidoCloud): ContenidoEntrante {
    switch (contenido.tipo) {
      case 'texto':
        return contenido;
      // La Cloud API no dice la duración ni el peso: los topes los aplica la descarga.
      case 'audio':
        return { tipo: 'audio', segundos: 0, media: this.media(cuenta, contenido.mediaId, contenido.mime) };
      case 'imagen':
        return { tipo: 'imagen', caption: contenido.caption, media: this.media(cuenta, contenido.mediaId, contenido.mime) };
      default:
        return { tipo: 'otro' };
    }
  }

  private media(cuenta: CuentaCloud, mediaId: string, mime: string | null): MediaEntrante {
    return {
      bytes: 0,
      mime,
      descargable: true,
      descargar: async (maxBytes, plazoMs) => {
        const { url, bytes } = await this.graph.urlDeMedia(mediaId, cuenta.token);
        if (bytes !== null && bytes > maxBytes) return null;
        return this.graph.descargar(url, cuenta.token, maxBytes, plazoMs);
      },
    };
  }
}

/** Un número de la API oficial visto como `SesionCanal`: uno por conexión. */
class SesionCloud implements SesionCanal {
  readonly proveedor = 'cloud' as const;
  private readonly logger = new Logger('SesionCloud');
  private readonly enviados = new Set<string>();
  /** El último mensaje de cada chat: el "escribiendo…" de la Cloud API va atado a uno. */
  private readonly ultimoRecibido = new Map<string, string>();
  private readonly escribiendoDesde = new Map<string, number>();

  constructor(
    private readonly cuenta: CuentaCloud,
    private readonly duenio: CloudProveedor,
    private readonly graph: GraphClient,
    private readonly prisma: PrismaService,
  ) {}

  get userId(): string {
    return this.cuenta.userId;
  }

  vigente(): boolean {
    return this.duenio.vigente(this.cuenta);
  }

  recibido(chat: string, idExterno: string): void {
    this.ultimoRecibido.delete(chat);
    this.ultimoRecibido.set(chat, idExterno);
    if (this.ultimoRecibido.size > MAX_ENVIADOS_RECORDADOS) {
      this.ultimoRecibido.delete(this.ultimoRecibido.keys().next().value!);
    }
  }

  /** El `wa_id` de un chat: el del JID, o el número guardado aparte de un chat LID de Baileys. */
  private async destinatario(chat: string): Promise<string> {
    const [usuario, dominio] = chat.split('@');
    if (dominio === 's.whatsapp.net') {
      const id = idDeWhatsapp(usuario);
      if (id) return id;
    } else if (dominio === 'lid') {
      const conversacion = await this.prisma.conversation.findUnique({
        where: { userId_remoteJid: { userId: this.userId, remoteJid: chat } },
        select: { telefono: true },
      });
      const id = idDeWhatsapp(conversacion?.telefono);
      if (id) return id;
    }
    throw new Error('El chat no tiene un número al que mandar por la API oficial.');
  }

  async enviar(chat: string, contenido: ContenidoSaliente): Promise<void> {
    const para = await this.destinatario(chat);
    const { phoneNumberId, token } = this.cuenta;
    try {
      const mensaje =
        'texto' in contenido
          ? { recipient_type: 'individual', to: para, type: 'text', text: { body: contenido.texto, preview_url: false } }
          : {
              recipient_type: 'individual',
              to: para,
              type: 'image',
              image: {
                id: await this.graph.subirImagen(phoneNumberId, token, contenido.imagen),
                ...(contenido.leyenda ? { caption: contenido.leyenda } : {}),
              },
            };
      const id = await this.graph.enviar(phoneNumberId, token, mensaje);
      if (id) this.recordarEnviado(id);
      this.escribiendoDesde.delete(chat);
    } catch (error) {
      if (error instanceof ErrorDeGraph && error.tokenInvalido) this.duenio.tokenRechazado(this.cuenta);
      throw error;
    }
  }

  private recordarEnviado(id: string): void {
    this.enviados.add(id);
    if (this.enviados.size > MAX_ENVIADOS_RECORDADOS) this.enviados.delete(this.enviados.values().next().value!);
  }

  esEnviadoPorTrato(idExterno: string | null | undefined): boolean {
    return Boolean(idExterno && this.enviados.has(idExterno));
  }

  chatPropio(): string | null {
    return null;
  }

  marcarLeido(entrante: EntranteCanal): void {
    if (typeof entrante.ref !== 'string') return;
    this.estadoDeLectura(entrante.ref, false);
  }

  escribiendo(chat: string, escribe: boolean): void {
    // La Cloud API no tiene "dejó de escribir": se apaga sola o con la respuesta.
    if (!escribe) return;
    const id = this.ultimoRecibido.get(chat);
    const desde = this.escribiendoDesde.get(chat) ?? 0;
    if (!id || Date.now() - desde < RENOVAR_ESCRIBIENDO_MS) return;
    this.escribiendoDesde.set(chat, Date.now());
    this.estadoDeLectura(id, true);
  }

  /** La Cloud API no avisa cuándo escribe el cliente: queda el silencio fijo de la ráfaga. */
  seguirPresencia(): void {
    // Nada que suscribir: la ráfaga espera su silencio fijo.
  }

  /** Lo cosmético nunca frena ni falla. */
  private estadoDeLectura(messageId: string, escribiendo: boolean): void {
    void this.graph
      .enviar(this.cuenta.phoneNumberId, this.cuenta.token, {
        status: 'read',
        message_id: messageId,
        ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}),
      })
      .catch((error: unknown) => this.logger.debug(`Sin marcar leído en ${this.userId}: ${(error as Error).message}`));
  }
}
