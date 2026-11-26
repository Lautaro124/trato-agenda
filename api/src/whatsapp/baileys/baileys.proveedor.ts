import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  isJidGroup,
  isJidStatusBroadcast,
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type proto,
  type AnyMessageContent,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  type WAVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Observable, ReplaySubject, map } from 'rxjs';
import { Limitador } from '../../auth/limitador.js';
import { claveDeTelefono, telefonoParaWhatsapp } from '../../auth/telefono.js';
import { referenciaDeAnuncio } from '../../comercio/anuncios.rules.js';
import { telefonoDeJid } from '../../comercio/ventas.rules.js';
import type { Env } from '../../config/env.js';
import { avisoWhatsappCaido, avisoWhatsappParaVolverAVincular, type Aviso } from '../../notificaciones/avisos.js';
import { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import { avisarASentry } from '../../observabilidad/aviso-a-sentry.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheConVencimiento, MensajesEnviados, TTL_REINTENTOS_MS } from '../caches.js';
import { PREFIJO_TIEMPOS, timestampEnMs } from '../metricas.js';
import type {
  ContenidoEntrante,
  ContenidoSaliente,
  EntranteCanal,
  MediaEntrante,
  ProveedorWhatsapp,
  ReceptorCanal,
  SesionCanal,
} from '../proveedor/proveedor.js';
import {
  MINUTOS_CAIDO_PARA_AVISAR,
  correspondeAvisarCaida,
  demoraDeReconexion,
  politicaDeCierre,
} from '../reconexion.js';
import { copiarSesion, estaVinculado, extraerTelefono, usePrismaAuthState } from '../whatsapp-auth-state.js';
import type { LinkEvent, WhatsappStatus } from '../whatsapp.types.js';
import { randomInt } from 'node:crypto';

/**
 * Un usuario sin Google ni teléfono es un alta por WhatsApp que todavía no
 * terminó: si el número escaneado ya es de otra cuenta, no es un error, es
 * alguien volviendo a entrar, y `AltaWhatsappService.finalizar` lo resuelve.
 */
export function esAltaPendiente(user: { googleId: string | null; phoneNumber: string | null }): boolean {
  return user.googleId === null && user.phoneNumber === null;
}

/** JID del chat consigo mismo ("Vos" en WhatsApp). */
export function jidPropio(telefono: string): string {
  return `${telefono}@s.whatsapp.net`;
}

/**
 * Códigos de vinculación que se pueden pedir por número y por hora. Cada pedido
 * le manda una notificación a ese teléfono, y quien lo pide no prueba todavía
 * que sea suyo: sin esto, cualquiera podría llenarle de avisos el WhatsApp a otro.
 */
export const MAX_CODIGOS_POR_NUMERO_HORA = 5;
/**
 * Y por cuenta (o alta): sin esto una sola cuenta podía mandarle la
 * notificación a un número distinto en cada pedido, y cada pedido abre un
 * socket desde la IP del servidor.
 */
export const MAX_CODIGOS_POR_CUENTA = 5;
const QUINCE_MINUTOS_MS = 15 * 60 * 1000;
/** Cuánto esperar a que el socket nuevo hable con WhatsApp antes de pedir el código. */
export const ESPERA_SOCKET_LISTO_MS = 20_000;
const UNA_HORA_MS = 60 * 60 * 1000;
/** Cada cuánto se vuelve a preguntar la versión de WhatsApp Web, y cuánto se la espera. */
const VIGENCIA_VERSION_WA_MS = 12 * UNA_HORA_MS;
const ESPERA_VERSION_WA_MS = 5_000;
const REINTENTO_VERSION_WA_MS = 10 * 60 * 1000;

/**
 * Cómo se presenta el socket ante WhatsApp. Tiene que ser un navegador que
 * WhatsApp conozca y con versión fija: con un nombre propio
 * (`Browsers.appropriate('Trato')`, que además mandaba el kernel del
 * contenedor como versión) el QR andaba, pero el código de vinculación
 * (`requestPairingCode`) se rechazaba siempre como "código incorrecto".
 * Por eso en "Dispositivos vinculados" aparece "Chrome (Ubuntu)" y no "Trato".
 */
export const NAVEGADOR_WHATSAPP = Browsers.ubuntu('Chrome');

/** "ABCD1234" → "ABCD-1234", como lo muestra WhatsApp al pedirlo. */
export function formatearCodigoDeVinculacion(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

/** Forma mínima que necesitamos de un error de desconexión de Baileys (Boom). */
type ErrorConDisconnectCode = { output?: { statusCode?: number } };

function codigoDeDesconexion(error: unknown): number | undefined {
  return (error as ErrorConDisconnectCode | undefined)?.output?.statusCode;
}

/** `fileLength` de WhatsApp puede llegar como Long. */
function aNumero(valor: number | { toNumber(): number } | null | undefined): number {
  if (valor == null) return 0;
  return typeof valor === 'number' ? valor : valor.toNumber();
}

/** Host de media de WhatsApp cuando el mensaje no trae `url`. */
const HOST_MEDIA_WHATSAPP = 'mmg.whatsapp.net';

/**
 * El host del que se puede bajar el audio, o undefined si el mensaje apunta a
 * otro lado. `url` y `directPath` los arma el que manda el mensaje y Baileys
 * los usa tal cual: sin esto, un cliente modificado haría que la API pida
 * cualquier URL (red interna, metadata del proveedor…). Exige un `directPath`
 * de ruta simple (sin `@`, `\`, `//` ni `:`, que cambiarían el host al
 * concatenarlo) y, si viene `url`, que sea https de `*.whatsapp.net`.
 */
export function hostDeMedia(media: { url?: string | null; directPath?: string | null }): string | undefined {
  if (!media.directPath || !/^\/(?!\/)[\w\-.~%/?=&+]*$/.test(media.directPath)) return undefined;
  if (!media.url) return HOST_MEDIA_WHATSAPP;
  try {
    const url = new URL(media.url);
    const esDeWhatsapp = url.protocol === 'https:' && !url.port && url.hostname.endsWith('.whatsapp.net');
    return esDeWhatsapp && !url.username && !url.password ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

type FlujoDeMedia = AsyncIterable<Buffer> & { destroy(): void };

/**
 * Abre la descarga y la junta con tope de bytes y de tiempo. Baileys no deja
 * pasarle un AbortSignal: al vencer el plazo se destruye el stream (o el que
 * llegue tarde), así un servidor que manda de a gotas no deja el chat trabado.
 */
async function descargarConTope(abrir: () => Promise<FlujoDeMedia>, max: number, plazoMs: number): Promise<Buffer | null> {
  const descarga = abrir();
  let timer: NodeJS.Timeout | undefined;
  const vencimiento = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`La descarga pasó ${plazoMs}ms.`)), plazoMs);
  });
  let flujo: FlujoDeMedia | undefined;
  try {
    flujo = await Promise.race([descarga, vencimiento]);
    return await Promise.race([leerHasta(flujo, max), vencimiento]);
  } finally {
    clearTimeout(timer);
    if (flujo) flujo.destroy();
    else void descarga.then((tarde) => tarde.destroy(), () => undefined);
  }
}

/** Junta el stream en memoria; null (y lo corta) si pasa de `max` bytes. */
async function leerHasta(flujo: FlujoDeMedia, max: number): Promise<Buffer | null> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of flujo) {
    total += parte.length;
    if (total > max) {
      flujo.destroy();
      return null;
    }
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

function aContenidoBaileys(contenido: ContenidoSaliente): AnyMessageContent {
  return 'texto' in contenido
    ? { text: contenido.texto }
    : { image: contenido.imagen, mimetype: 'image/jpeg', caption: contenido.leyenda };
}

/** Una conexión de Baileys vista como `SesionCanal`: una por socket. */
class SesionBaileys implements SesionCanal {
  readonly proveedor = 'baileys' as const;

  constructor(
    readonly userId: string,
    readonly sock: WASocket,
    private readonly duenio: BaileysProveedor,
  ) {}

  vigente(): boolean {
    return this.duenio.socketDe(this.userId) === this.sock;
  }

  /**
   * Toda salida a un cliente pasa por acá: lo enviado queda en `enviados`
   * para que `getMessage` lo encuentre si el cliente pide reenvío.
   */
  async enviar(chat: string, contenido: ContenidoSaliente): Promise<void> {
    const enviado = await this.sock.sendMessage(chat, aContenidoBaileys(contenido));
    this.duenio.enviados.guardar(this.userId, enviado?.key.id, enviado?.message);
  }

  esEnviadoPorTrato(idExterno: string | null | undefined): boolean {
    return this.duenio.enviados.buscar(this.userId, idExterno) !== undefined;
  }

  chatPropio(): string | null {
    const telefono = estaVinculado(this.sock.authState.creds) ? extraerTelefono(this.sock.authState.creds) : undefined;
    return telefono ? jidPropio(telefono) : null;
  }

  marcarLeido(entrante: EntranteCanal): void {
    const key = entrante.ref as WAMessageKey | undefined;
    if (key) void this.sock.readMessages([key]).catch(() => undefined);
  }

  escribiendo(chat: string, escribe: boolean): void {
    this.sock.sendPresenceUpdate(escribe ? 'composing' : 'paused', chat).catch(() => undefined);
  }

  seguirPresencia(chat: string): void {
    this.sock.presenceSubscribe(chat).catch(() => undefined);
  }
}

/**
 * El transporte de WhatsApp por Baileys (LAU-110): sockets, credenciales
 * cifradas, vinculación por QR o código con SSE, reconexión y la traducción
 * de lo que llega y sale a `EntranteCanal` / `SesionCanal`. Lo que se hace
 * con cada mensaje lo decide `WhatsappService` (el `ReceptorCanal`).
 */
@Injectable()
export class BaileysProveedor implements ProveedorWhatsapp, OnModuleInit, OnModuleDestroy {
  readonly id = 'baileys' as const;
  private readonly logger = new Logger(BaileysProveedor.name);
  private readonly baileysLogger: pino.Logger;
  private receptor: ReceptorCanal | null = null;

  private readonly sockets = new Map<string, WASocket>();
  private readonly sesiones = new WeakMap<WASocket, SesionBaileys>();
  private readonly events = new Map<string, ReplaySubject<LinkEvent>>();
  /** Reintentos desde la última conexión abierta (ver reconexion.ts). */
  private readonly reconnectAttempts = new Map<string, number>();
  /** El reintento programado de cada usuario: cerrar o desvincular lo cancela. */
  private readonly reconexionesPendientes = new Map<string, NodeJS.Timeout>();
  /** Desde cuándo está caída una sesión vinculada, para avisar si no vuelve. */
  private readonly caidoDesde = new Map<string, number>();
  /** Caídas ya avisadas: una sola vez por caída. */
  private readonly caidaAvisada = new Set<string>();
  /** `badSession` seguidos por usuario (ver MAX_SESIONES_MALAS_SEGUIDAS). */
  private readonly sesionesMalas = new Map<string, number>();
  /** Última promesa de `saveCreds` en vuelo por usuario, para no emitir "connected" antes de que persista. */
  private readonly pendingSaves = new Map<string, Promise<void>>();
  /** Espera los guardados en vuelo de la sesión (creds y claves) de cada usuario. */
  private readonly guardadosEnVuelo = new Map<string, () => Promise<void>>();
  /** Distingue el "connecting" del arranque del socket del "connecting" post-escaneo. */
  private readonly qrMostrado = new Set<string>();
  /** Cuándo arrancó el socket vivo de cada usuario, para medir cuánto tarda en abrir. */
  private readonly conectandoDesde = new Map<string, number>();
  /**
   * Usuarios vinculando con código (desde el mismo celular) en vez de QR. Un
   * corte antes de que ingresen el código no se reintenta: las credenciales ya
   * tienen el número en `me` y reconectar intentaría un login que no existe.
   */
  private readonly modoCodigo = new Set<string>();
  /**
   * Quien espera el primer QR de un socket nuevo: es la señal de que ya habló
   * con WhatsApp. Por socket y no por usuario, así dos pedidos seguidos no se
   * pisan la espera.
   */
  private readonly esperandoQr = new Map<WASocket, () => void>();
  private readonly codigosPorNumero = new Limitador(MAX_CODIGOS_POR_NUMERO_HORA, UNA_HORA_MS);
  private readonly codigosPorCuenta = new Limitador(MAX_CODIGOS_POR_CUENTA, QUINCE_MINUTOS_MS);
  /** Un pedido de código a la vez por cuenta: dos seguidos se cerraban el socket entre sí. */
  private readonly pidiendoCodigo = new Set<string>();
  /** Cuántas veces pidió reenvío cada mensaje; Baileys lo usa para no reintentar para siempre. */
  private readonly reintentosDeMensajes = new CacheConVencimiento(TTL_REINTENTOS_MS);
  /** Lo último que mandó cada cuenta, para reenviarlo si el teléfono del cliente no lo pudo descifrar. */
  readonly enviados = new MensajesEnviados();
  /** Versión de WhatsApp Web con la que se conecta; se refresca cada VIGENCIA_VERSION_WA_MS. */
  private versionWa: { version: WAVersion; hasta: number } | null = null;
  private consultandoVersion: Promise<WAVersion> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly notificaciones: NotificacionesService,
  ) {
    this.baileysLogger = pino({
      level: this.config.get('NODE_ENV', { infer: true }) === 'production' ? 'warn' : 'debug',
    });
  }

  escuchar(receptor: ReceptorCanal): void {
    this.receptor = receptor;
  }

  /** El socket vivo de la cuenta (lo usa `SesionBaileys.vigente`). */
  socketDe(userId: string): WASocket | undefined {
    return this.sockets.get(userId);
  }

  /** Al bootear la API, resumimos toda sesión que ya haya completado el pairing. */
  async onModuleInit(): Promise<void> {
    const sesiones = await this.prisma.whatsappSession.findMany({
      where: { registered: true },
      select: { userId: true },
    });

    for (const { userId } of sesiones) {
      this.connect(userId).catch((error: unknown) =>
        this.logger.error(`No se pudo resumir la sesión de WhatsApp de ${userId}`, error as Error),
      );
    }
  }

  /** Apagado prolijo: cerramos el transporte sin invalidar la sesión guardada. */
  async onModuleDestroy(): Promise<void> {
    for (const timer of this.reconexionesPendientes.values()) clearTimeout(timer);
    this.reconexionesPendientes.clear();
    await Promise.all(
      [...this.sockets.values()].map((sock) => sock.end(undefined).catch(() => undefined)),
    );
  }

  /** Stream de eventos de vinculación para un usuario, listo para `@Sse()`. */
  linkEvents$(userId: string): Observable<MessageEvent> {
    return this.getOrCreateSubject(userId).asObservable().pipe(map((data) => ({ data })));
  }

  sesionVinculada(userId: string): SesionCanal | null {
    const sock = this.sockets.get(userId);
    return sock && estaVinculado(sock.authState.creds) ? this.sesionDe(userId, sock) : null;
  }

  private sesionDe(userId: string, sock: WASocket): SesionBaileys {
    let sesion = this.sesiones.get(sock);
    if (!sesion) {
      sesion = new SesionBaileys(userId, sock, this);
      this.sesiones.set(sock, sesion);
    }
    return sesion;
  }

  /**
   * Arranca (o resume) la vinculación de un usuario. Idempotente: si ya hay
   * una sesión conectada, sólo re-emite "connected".
   */
  async startLink(userId: string): Promise<void> {
    const socketVivo = this.sockets.get(userId);
    if (socketVivo && estaVinculado(socketVivo.authState.creds)) {
      this.emit(userId, {
        state: 'connected',
        phoneNumber: extraerTelefono(socketVivo.authState.creds),
      });
      return;
    }

    // Venga de un QR vencido o de un código a medio ingresar, se arranca limpio.
    await this.empezarDeCero(userId);
    await this.connect(userId);
  }

  /**
   * Vincular sin QR, desde el mismo celular: WhatsApp le manda una
   * notificación a ese número y la persona ingresa el código que devolvemos
   * ("Vincular con el número de teléfono"). Siempre con un socket nuevo,
   * porque un código anterior queda guardado en las credenciales.
   *
   * No mira si el número ya tiene cuenta en Trato (eso diría qué números
   * existen): igual que con el QR, `asignarTelefono` lo resuelve al conectar.
   */
  async pedirCodigo(userId: string, telefono: string): Promise<string> {
    if (this.pidiendoCodigo.has(userId)) {
      throw new ConflictException('Ya estamos pidiendo un código: esperá un momento.');
    }
    this.pidiendoCodigo.add(userId);
    try {
      return await this.pedirCodigoSinPisarse(userId, telefono);
    } finally {
      this.pidiendoCodigo.delete(userId);
    }
  }

  private async pedirCodigoSinPisarse(userId: string, telefono: string): Promise<string> {
    const socketVivo = this.sockets.get(userId);
    // La base y no sólo el socket: una sesión vinculada puede estar sin socket
    // un rato (reconectando, al arrancar) y empezar de cero la dejaría muda.
    const sesion = await this.prisma.whatsappSession.findUnique({ where: { userId }, select: { registered: true } });
    if (sesion?.registered || (socketVivo && estaVinculado(socketVivo.authState.creds))) {
      throw new ConflictException('Este WhatsApp ya está vinculado.');
    }
    if (!this.codigosPorCuenta.permitir(userId)) {
      throw new HttpException('Pediste demasiados códigos: probá en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.codigosPorNumero.permitir(claveDeTelefono(telefono))) {
      throw new HttpException('Pediste demasiados códigos para ese número: probá en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.empezarDeCero(userId);
    this.modoCodigo.add(userId);
    await this.connect(userId);
    // `connect` vuelve apenas crea el socket, antes de que llegue nada de la
    // red: registrar la espera acá no se pierde el primer QR.
    const sock = this.sockets.get(userId);
    try {
      if (!sock) throw new Error('El socket no quedó registrado.');
      await this.esperarPrimerQr(sock);
      return formatearCodigoDeVinculacion(await sock.requestPairingCode(telefonoParaWhatsapp(telefono)));
    } catch (error) {
      // Sin el número ni el código: sólo el id y el motivo.
      this.logger.warn(`No se pudo pedir el código de vinculación de ${userId}: ${(error as Error).message}`);
      // Si otro pedido ya lo reemplazó, ese socket no es nuestro para cerrar.
      if (sock && this.sockets.get(userId) === sock) await this.empezarDeCero(userId);
      throw new ServiceUnavailableException('WhatsApp no respondió: probá de nuevo en un momento.');
    } finally {
      if (sock) this.esperandoQr.delete(sock);
    }
  }

  /** Estado de vinculación fuera del SSE, para el badge del header. */
  async status(userId: string): Promise<WhatsappStatus> {
    const session = await this.prisma.whatsappSession.findUnique({ where: { userId } });
    return { linked: session?.registered ?? false, phoneNumber: session?.phoneNumber ?? null };
  }

  /** Cierra la sesión y borra las credenciales guardadas. */
  async unlink(userId: string): Promise<void> {
    // Lo que un cliente escribió y todavía no se contestó (o se está armando)
    // no sale: tras la baja de la cuenta no tiene a quién responderle.
    this.receptor?.sesionCerrada(userId);
    const socketVivo = this.sockets.get(userId);
    if (socketVivo) {
      // Dispara connection.update con loggedOut, que hace la limpieza (ver handleConnectionUpdate).
      await socketVivo.logout().catch(() => undefined);
      return;
    }

    // Sin socket puede haber un reintento esperando: que no reviva lo que se desvinculó.
    this.cancelarReconexion(userId);
    this.olvidarCaida(userId);
    await this.prisma.whatsappSession.deleteMany({ where: { userId } });
  }

  /**
   * Manda un mensaje al chat propio del titular (lo usa el login con código).
   * Devuelve false si no hay un socket vinculado por donde mandarlo.
   */
  async enviarAlPropioChat(userId: string, texto: string): Promise<boolean> {
    const sock = this.sockets.get(userId);
    const telefono = sock && estaVinculado(sock.authState.creds) ? extraerTelefono(sock.authState.creds) : undefined;
    if (!sock || !telefono) return false;
    // `handleMessagesUpsert` ignora los `fromMe`: el asistente no se contesta esto.
    // Directo y no por `SesionCanal.enviar`: puede ser un código de acceso, que
    // no queda en memoria para reenvíos (la base sólo guarda su hash).
    await sock.sendMessage(jidPropio(telefono), { text: texto });
    return true;
  }

  /**
   * Alguien escaneó el QR de un alta con un número que ya es de otra cuenta:
   * esa cuenta se queda con la vinculación nueva y el usuario pendiente se
   * descarta (lo borra quien llama). El orden importa porque `saveCreds`
   * escribe por `userId`:
   *
   * 1. se espera a que el pendiente termine de persistir y se cierra su socket
   *    sin logout (sus credenciales son las buenas);
   * 2. se cierra la sesión vieja de la cuenta con logout, sacándola antes del
   *    mapa para que su `loggedOut` no borre la fila que estamos por escribir;
   * 3. se copian credenciales y claves a la cuenta (`copiarSesion`) y se
   *    reconecta con su `userId`.
   */
  async transferirSesion(desde: string, hacia: string): Promise<void> {
    await this.esperarGuardados(desde);
    await this.cerrarSocket(desde, 'end');
    await this.cerrarSocket(hacia, 'logout');
    // Cerrar también puede guardar: nada de ninguno de los dos puede escribir después de copiar.
    await Promise.all([this.esperarGuardados(desde), this.esperarGuardados(hacia)]);

    await copiarSesion(this.prisma, desde, hacia);
    this.pendingSaves.delete(desde);
    this.guardadosEnVuelo.delete(desde);
    this.events.get(desde)?.complete();
    this.events.delete(desde);

    this.reconnectAttempts.delete(hacia);
    await this.connect(hacia);
  }

  /** Cierra el socket de un alta abandonada sin tocar el teléfono de nadie. */
  async descartar(userId: string): Promise<void> {
    await this.descartarSinCerrarEventos(userId);
    this.events.get(userId)?.complete();
    this.events.delete(userId);
  }

  /**
   * El número detrás de un JID LID, según el mapeo que guarda la sesión de
   * WhatsApp de la cuenta. Null si no es LID, la cuenta no está conectada o
   * WhatsApp todavía no compartió el número.
   */
  async telefonoDeChat(userId: string, remoteJid: string): Promise<string | null> {
    if (!isLidUser(remoteJid)) return null;
    const sock = this.sockets.get(userId);
    if (!sock) return null;
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(remoteJid);
      return pn ? telefonoDeJid(jidNormalizedUser(pn)) : null;
    } catch {
      return null;
    }
  }

  /**
   * Saca el socket del mapa antes de cerrarlo: desde ahí sus eventos son de un
   * socket viejo y `handleConnectionUpdate` los ignora.
   */
  private async cerrarSocket(userId: string, modo: 'end' | 'logout'): Promise<void> {
    // Lo que un cliente escribió y todavía no se contestó no sale por un socket cerrado.
    this.receptor?.sesionCerrada(userId);
    this.modoCodigo.delete(userId);
    this.enviados.olvidar(userId);
    this.cancelarReconexion(userId);
    this.olvidarCaida(userId);
    this.sesionesMalas.delete(userId);
    const sock = this.sockets.get(userId);
    if (!sock) return;
    this.sockets.delete(userId);
    this.reconnectAttempts.delete(userId);
    this.qrMostrado.delete(userId);
    if (modo === 'logout') await sock.logout().catch(() => undefined);
    await sock.end(undefined).catch(() => undefined);
  }

  /**
   * Deja el número recién vinculado en `User.phoneNumber`, que es con lo que
   * se entra después por código. Devuelve false si el número es de otra
   * cuenta y este usuario no es un alta pendiente (un titular de Google
   * vinculando el WhatsApp de otro).
   */
  private async asignarTelefono(userId: string, telefono: string): Promise<boolean> {
    const [user, dueno] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { googleId: true, phoneNumber: true } }),
      this.prisma.user.findUnique({ where: { phoneNumber: telefono }, select: { id: true } }),
    ]);
    if (!user) return false;
    if (dueno && dueno.id !== userId) return esAltaPendiente(user);
    if (user.phoneNumber !== telefono) {
      await this.prisma.user.update({ where: { id: userId }, data: { phoneNumber: telefono } });
    }
    return true;
  }

  /**
   * Cierra el socket sin vincular y borra lo que haya quedado a medio
   * guardar: una sesión ya vinculada (`registered: true`) no se toca.
   */
  private async empezarDeCero(userId: string): Promise<void> {
    await this.cerrarSocket(userId, 'end');
    await this.esperarGuardados(userId);
    await this.prisma.whatsappSession.deleteMany({ where: { userId, registered: false } });
    this.reconnectAttempts.delete(userId);
  }

  /** Se resuelve con el primer QR de ese socket, o falla a los ESPERA_SOCKET_LISTO_MS. */
  private esperarPrimerQr(sock: WASocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WhatsApp no mandó el QR a tiempo.')), ESPERA_SOCKET_LISTO_MS);
      timer.unref();
      this.esperandoQr.set(sock, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async connect(userId: string): Promise<void> {
    const { state, saveCreds, esperarGuardados } = await usePrismaAuthState(
      this.prisma,
      userId,
      this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true }),
    );

    const version = await this.versionDeWhatsappWeb();

    const sock = makeWASocket({
      // Con caché delante, cada lectura de clave no es una consulta a Postgres.
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.baileysLogger) },
      logger: this.baileysLogger,
      browser: NAVEGADOR_WHATSAPP,
      version,
      // El historial que baja al vincular se ignora (`type !== 'notify'`), y
      // descifrarlo demoraba la vinculación y retenía los mensajes nuevos.
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      // En línea, el teléfono del dueño deja de recibir notificaciones.
      markOnlineOnConnect: false,
      msgRetryCounterCache: this.reintentosDeMensajes,
      getMessage: async (key) => this.enviados.buscar(userId, key.id),
    });

    this.sockets.set(userId, sock);
    this.guardadosEnVuelo.set(userId, esperarGuardados);
    this.qrMostrado.delete(userId);
    this.conectandoDesde.set(userId, Date.now());
    sock.ev.on('creds.update', () => {
      this.pendingSaves.set(userId, saveCreds());
    });
    sock.ev.on('connection.update', (update) => {
      this.handleConnectionUpdate(userId, update, sock).catch((error: unknown) =>
        this.logger.error(`Fallo procesando connection.update de ${userId}`, error as Error),
      );
    });
    // "Escribiendo…" del cliente: demora la respuesta de una ráfaga que todavía espera.
    sock.ev.on('presence.update', ({ id, presences }) => {
      const estados = Object.values(presences).map((presencia) => presencia.lastKnownPresence);
      if (estados.length === 0) return;
      const escribe = estados.some((estado) => estado === 'composing' || estado === 'recording');
      this.receptor?.clienteEscribiendo(this.sesionDe(userId, sock), id, escribe);
    });
    sock.ev.on('messages.upsert', (upsert) => {
      this.handleMessagesUpsert(userId, sock, upsert).catch((error: unknown) =>
        this.logger.error(`Fallo procesando mensajes entrantes de ${userId}`, error as Error),
      );
    });
  }

  /**
   * Lo que llega por el socket, traducido a `EntranteCanal`. Sólo chats 1:1
   * en vivo: se ignoran grupos, estados de contactos y el historial que llega
   * al conectar. Qué se hace con cada uno lo decide el receptor.
   */
  private async handleMessagesUpsert(
    userId: string,
    sock: WASocket,
    upsert: { messages: WAMessage[]; type: string },
  ): Promise<void> {
    if (upsert.type !== 'notify' || !this.receptor) return;
    const sesion = this.sesionDe(userId, sock);
    const entrantes: EntranteCanal[] = [];
    for (const mensaje of upsert.messages) {
      const remoteJid = mensaje.key.remoteJid;
      // Ni grupos ni estados: un estado de un contacto no es un mensaje al
      // negocio, y contestarlo publicaría en `status@broadcast`.
      if (!remoteJid || isJidGroup(remoteJid) || isJidStatusBroadcast(remoteJid)) continue;
      // Un chat LID no trae el número en el JID: WhatsApp lo manda aparte.
      const alternativo = isLidUser(remoteJid) ? mensaje.key.remoteJidAlt : undefined;
      const telefono = alternativo ? telefonoDeJid(jidNormalizedUser(alternativo)) : null;
      const deMi = Boolean(mensaje.key.fromMe);
      const contenido = this.contenidoDe(sock, mensaje, deMi);
      // El anuncio o el estado propio desde el que escribió (LAU-103), venga en un texto, una imagen o un audio.
      const referencia = deMi ? null : referenciaDeAnuncio(mensaje.message);
      const { imagen: imagenDelEstado, ...anuncio } = referencia ?? {};
      entrantes.push({
        sesion,
        chat: remoteJid,
        idExterno: mensaje.key.id ?? null,
        deMi,
        telefono,
        enviadoEn: timestampEnMs(mensaje.messageTimestamp),
        anuncio: referencia ? (anuncio as EntranteCanal['anuncio']) : null,
        ...(imagenDelEstado ? { imagenDelAnuncio: this.mediaDe(sock, mensaje.key, { imageMessage: imagenDelEstado }, imagenDelEstado) } : {}),
        contenido,
        ref: mensaje.key,
      });
    }
    await this.receptor.recibir(entrantes);
  }

  /** Texto, audio o imagen; del dueño, sólo el texto (lo demás lo tiene en su teléfono). */
  private contenidoDe(sock: WASocket, mensaje: WAMessage, deMi: boolean): ContenidoEntrante {
    const texto = mensaje.message?.conversation ?? mensaje.message?.extendedTextMessage?.text;
    if (texto) return { tipo: 'texto', texto };
    if (deMi) return { tipo: 'otro' };
    const audio = mensaje.message?.audioMessage;
    if (audio) {
      // Sólo el audio validado: Baileys descarga el primer contenido con media
      // que encuentre (o el de adentro de un `ephemeralMessage`), y el
      // remitente podría poner otro antes, sin validar.
      return { tipo: 'audio', segundos: audio.seconds ?? 0, media: this.mediaDe(sock, mensaje.key, { audioMessage: audio }, audio) };
    }
    const imagen = mensaje.message?.imageMessage;
    if (imagen) {
      return { tipo: 'imagen', caption: imagen.caption, media: this.mediaDe(sock, mensaje.key, { imageMessage: imagen }, imagen) };
    }
    return { tipo: 'otro' };
  }

  /**
   * Un audio o una imagen de WhatsApp, para bajar en stream y con tope:
   * `seconds` y `fileLength` los declara el que manda y pueden mentir. `host`
   * fijo: el reintento por reupload no puede volver a sacarlo de `url`.
   */
  private mediaDe(
    sock: WASocket,
    key: WAMessageKey,
    soloEsto: proto.IMessage,
    media: { url?: string | null; directPath?: string | null; mimetype?: string | null; fileLength?: number | { toNumber(): number } | null },
  ): MediaEntrante {
    const host = hostDeMedia(media);
    return {
      bytes: aNumero(media.fileLength),
      mime: media.mimetype,
      descargable: host !== undefined,
      descargar: (maxBytes, plazoMs) => {
        if (!host) return Promise.resolve(null);
        const mensaje: WAMessage = { key, message: soloEsto };
        return descargarConTope(
          () =>
            downloadMediaMessage(mensaje, 'stream', { host }, { logger: this.baileysLogger, reuploadRequest: sock.updateMediaMessage }),
          maxBytes,
          plazoMs,
        );
      },
    };
  }

  /**
   * La versión de WhatsApp Web vigente: WhatsApp rechaza cada tanto las viejas
   * (405) y la de fábrica de Baileys envejece. Si no se puede averiguar,
   * `fetchLatestWaWebVersion` devuelve la de fábrica y se usa esa.
   */
  private versionDeWhatsappWeb(): Promise<WAVersion> {
    if (this.versionWa && this.versionWa.hasta > Date.now()) return Promise.resolve(this.versionWa.version);
    // Al bootear se resumen todas las sesiones a la vez: una sola consulta para todas.
    this.consultandoVersion ??= fetchLatestWaWebVersion({ signal: AbortSignal.timeout(ESPERA_VERSION_WA_MS) })
      .then(({ version, isLatest }) => {
        // Sin la última se vuelve a probar antes, en vez de quedarse 12 h con la de fábrica.
        const vigencia = isLatest ? VIGENCIA_VERSION_WA_MS : REINTENTO_VERSION_WA_MS;
        this.versionWa = { version, hasta: Date.now() + vigencia };
        this.logger.log(`Versión de WhatsApp Web: ${version.join('.')}${isLatest ? '' : ' (la de fábrica: no se pudo consultar)'}`);
        return version;
      })
      .finally(() => {
        this.consultandoVersion = null;
      });
    return this.consultandoVersion;
  }

  private async handleConnectionUpdate(
    userId: string,
    update: Partial<{ connection: 'open' | 'connecting' | 'close'; qr: string; lastDisconnect: { error: unknown } }>,
    sock?: WASocket,
  ): Promise<void> {
    // Un socket que ya no es el del usuario (transferido, descartado) no manda más.
    if (sock && this.sockets.get(userId) !== sock) return;

    if (update.qr) {
      if (sock) {
        this.esperandoQr.get(sock)?.();
        this.esperandoQr.delete(sock);
      }
      this.qrMostrado.add(userId);
      this.emit(userId, { state: 'active', qr: update.qr });
      return;
    }

    if (update.connection === 'connecting' && this.qrMostrado.has(userId)) {
      // El QR ya se mostró: este "connecting" es el handshake post-escaneo.
      this.emit(userId, { state: 'connecting' });
      return;
    }

    if (update.connection === 'open') {
      const desde = this.conectandoDesde.get(userId);
      if (desde !== undefined) {
        this.logger.log(`${PREFIJO_TIEMPOS} · conexión de ${userId} abierta en ${Date.now() - desde}ms`);
        this.conectandoDesde.delete(userId);
      }
      const caida = this.caidoDesde.get(userId);
      if (caida !== undefined) {
        this.logger.log(`${PREFIJO_TIEMPOS} · conexión de ${userId} recuperada tras ${Math.round((Date.now() - caida) / 1000)}s caída`);
      }
      this.olvidarCaida(userId);
      this.sesionesMalas.delete(userId);
      this.reconnectAttempts.delete(userId);
      this.qrMostrado.delete(userId);
      this.modoCodigo.delete(userId);
      const sock = this.sockets.get(userId);
      const phoneNumber = sock && extraerTelefono(sock.authState.creds);
      // Esperamos a que el último `creds.update` haya persistido antes de avisar
      // al frontend: si no, /whatsapp/status puede leer `registered: false` justo
      // después de que el usuario ve "conectado".
      await this.esperarGuardados(userId);
      if (phoneNumber && !(await this.asignarTelefono(userId, phoneNumber))) {
        this.logger.warn(`El número vinculado por ${userId} ya es de otra cuenta: se desvincula.`);
        this.emit(userId, { state: 'error', motivo: 'numero_en_uso' });
        await this.descartarSinCerrarEventos(userId);
        return;
      }
      this.receptor?.fallo(userId, this.id, null);
      this.emit(userId, { state: 'connected', phoneNumber: phoneNumber || undefined });
      return;
    }

    if (update.connection !== 'close') return;

    const codigo = codigoDeDesconexion(update.lastDisconnect?.error);
    this.conectandoDesde.delete(userId);
    const intentos = this.reconnectAttempts.get(userId) ?? 0;
    // Hoy un corte recuperable no dejaba rastro: con esto se ve cada cierre y su motivo.
    this.logger.warn(
      `${PREFIJO_TIEMPOS} · conexión de ${userId} cerrada (código ${codigo ?? 'desconocido'}, ` +
        `reintentos previos ${intentos})`,
    );

    const credenciales = (sock ?? this.sockets.get(userId))?.authState.creds;
    const vinculado = Boolean(credenciales && estaVinculado(credenciales));
    const sesionesMalas = codigo === DisconnectReason.badSession ? (this.sesionesMalas.get(userId) ?? 0) + 1 : 0;
    this.sesionesMalas.set(userId, sesionesMalas);

    switch (politicaDeCierre(codigo, { vinculado, modoCodigo: this.modoCodigo.has(userId), intentos, sesionesMalas })) {
      case 'desvincular':
        this.sockets.delete(userId);
        this.reconnectAttempts.delete(userId);
        this.sesionesMalas.delete(userId);
        this.cancelarReconexion(userId);
        this.olvidarCaida(userId);
        this.prisma.whatsappSession.deleteMany({ where: { userId } }).catch((error: unknown) =>
          this.logger.error(`No se pudo borrar la sesión de WhatsApp de ${userId}`, error as Error),
        );
        this.emit(userId, { state: 'error' });
        return;

      case 'codigo_vencido':
        // El código venció (o se cortó) antes de que lo ingresaran. Reconectar
        // con `me` ya puesto sería un login sin registro: se descarta y la
        // pantalla ofrece pedir otro.
        this.sockets.delete(userId);
        this.modoCodigo.delete(userId);
        this.qrMostrado.delete(userId);
        this.reconnectAttempts.delete(userId);
        this.sesionesMalas.delete(userId);
        this.prisma.whatsappSession.deleteMany({ where: { userId, registered: false } }).catch((error: unknown) =>
          this.logger.error(`No se pudo borrar el código vencido de ${userId}`, error as Error),
        );
        this.emit(userId, { state: 'expired' });
        return;

      case 'reiniciar':
        // Quirk conocido de Baileys justo después del primer pairing: no cuenta
        // como reintento ni se muestra como error.
        this.connect(userId).catch((error: unknown) =>
          this.logger.error(`Fallo al reconectar (restartRequired) a ${userId}`, error as Error),
        );
        return;

      case 'rendirse':
        await this.rendirse(userId, codigo, vinculado);
        return;

      case 'reintentar':
        this.programarReconexion(userId, codigo, vinculado);
        return;
    }
  }

  /**
   * Reintenta con backoff y jitter (reconexion.ts). Una sesión vinculada no
   * tiene tope de intentos: un corte de red de varios minutos se recupera
   * solo, y si dura más de MINUTOS_CAIDO_PARA_AVISAR se avisa una vez.
   */
  private programarReconexion(userId: string, codigo: number | undefined, vinculado: boolean): void {
    this.sockets.delete(userId);
    const intento = (this.reconnectAttempts.get(userId) ?? 0) + 1;
    this.reconnectAttempts.set(userId, intento);
    if (vinculado) {
      if (!this.caidoDesde.has(userId)) this.caidoDesde.set(userId, Date.now());
      this.avisarSiSigueCaido(userId, codigo, intento);
    }

    // randomInt y no Math.random: es sólo jitter, pero así no lo marca el análisis estático.
    const demora = demoraDeReconexion(intento, randomInt(0, 1001) / 1000, codigo);
    this.cancelarReconexion(userId);
    const timer = setTimeout(() => {
      this.reconexionesPendientes.delete(userId);
      void this.reconectar(userId, intento, codigo, vinculado);
    }, demora);
    timer.unref();
    this.reconexionesPendientes.set(userId, timer);
  }

  private async reconectar(userId: string, intento: number, codigo: number | undefined, vinculado: boolean): Promise<void> {
    try {
      if (vinculado) {
        // Si mientras esperábamos se desvinculó (o se dio por perdida), no se revive.
        await this.esperarGuardados(userId);
        const sesion = await this.prisma.whatsappSession.findUnique({ where: { userId }, select: { registered: true } });
        if (!sesion?.registered) {
          this.reconnectAttempts.delete(userId);
          this.olvidarCaida(userId);
          return;
        }
      }
      // Otro camino (un QR nuevo, una transferencia) ya abrió un socket: ése manda.
      if (this.sockets.has(userId)) return;
      await this.connect(userId);
    } catch (error) {
      this.logger.error(`Fallo al reconectar a ${userId} (intento ${intento})`, error as Error);
      // Sin socket no va a llegar otro "close" que lo reprograme.
      if (vinculado) this.programarReconexion(userId, codigo, vinculado);
      else this.emit(userId, { state: 'error' });
    }
  }

  /**
   * Reconectar no lo arregla (WhatsApp bloqueó los dispositivos vinculados, o
   * la sesión quedó inservible). Una sesión vinculada se marca sin vincular,
   * así ni el próximo arranque ni /vincular reanudan las mismas credenciales:
   * /vincular arranca de cero con un QR nuevo.
   */
  private async rendirse(userId: string, codigo: number | undefined, vinculado: boolean): Promise<void> {
    this.sockets.delete(userId);
    this.reconnectAttempts.delete(userId);
    this.sesionesMalas.delete(userId);
    this.cancelarReconexion(userId);
    this.olvidarCaida(userId);
    this.emit(userId, { state: 'error' });
    if (!vinculado) return;

    await this.prisma.whatsappSession.updateMany({ where: { userId }, data: { registered: false } });
    avisarASentry('WhatsApp dejó de aceptar una sesión vinculada', {
      fingerprint: ['whatsapp-sin-reconexion'],
      tags: { codigo },
      userId,
    });
    this.receptor?.fallo(userId, this.id, 'volver_a_vincular');
    await this.avisarAlDueno(userId, avisoWhatsappParaVolverAVincular());
  }

  /** Una vez por caída, pasados MINUTOS_CAIDO_PARA_AVISAR: a Sentry (sólo ids) y a la campanita del dueño. */
  private avisarSiSigueCaido(userId: string, codigo: number | undefined, intento: number): void {
    const desde = this.caidoDesde.get(userId);
    if (desde === undefined || this.caidaAvisada.has(userId) || !correspondeAvisarCaida(desde, Date.now())) return;
    this.caidaAvisada.add(userId);
    avisarASentry('WhatsApp lleva un rato sin poder reconectar', {
      fingerprint: ['whatsapp-caido'],
      tags: { codigo, intentos: intento },
      userId,
    });
    this.receptor?.fallo(userId, this.id, 'sin_conexion');
    void this.avisarAlDueno(userId, avisoWhatsappCaido(MINUTOS_CAIDO_PARA_AVISAR));
  }

  private async avisarAlDueno(userId: string, aviso: Aviso): Promise<void> {
    try {
      await this.notificaciones.avisar(userId, aviso);
    } catch (error) {
      this.logger.warn(`No se pudo guardar el aviso de WhatsApp de ${userId}: ${(error as Error).message}`);
    }
  }

  private cancelarReconexion(userId: string): void {
    const timer = this.reconexionesPendientes.get(userId);
    if (timer) clearTimeout(timer);
    this.reconexionesPendientes.delete(userId);
  }

  private olvidarCaida(userId: string): void {
    this.caidoDesde.delete(userId);
    this.caidaAvisada.delete(userId);
  }

  /** Como `descartar`, pero el SSE sigue abierto para que llegue el error. */
  private async descartarSinCerrarEventos(userId: string): Promise<void> {
    await this.cerrarSocket(userId, 'logout');
    await this.prisma.whatsappSession.deleteMany({ where: { userId } });
    this.pendingSaves.delete(userId);
    this.guardadosEnVuelo.delete(userId);
  }

  /** El último `saveCreds` y cualquier `keys.set` que siga escribiendo. */
  private async esperarGuardados(userId: string): Promise<void> {
    await (this.pendingSaves.get(userId) ?? Promise.resolve());
    await this.guardadosEnVuelo.get(userId)?.();
  }

  private getOrCreateSubject(userId: string): ReplaySubject<LinkEvent> {
    let subject = this.events.get(userId);
    if (!subject) {
      subject = new ReplaySubject<LinkEvent>(1);
      this.events.set(userId, subject);
    }
    return subject;
  }

  private emit(userId: string, event: LinkEvent): void {
    this.getOrCreateSubject(userId).next(event);
  }
}
