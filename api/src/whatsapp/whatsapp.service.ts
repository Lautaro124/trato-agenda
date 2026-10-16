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
  fetchLatestWaWebVersion,
  isJidGroup,
  makeCacheableSignalKeyStore,
  type AnyMessageContent,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  type WAVersion,
} from '@whiskeysockets/baileys';
import { randomInt } from 'node:crypto';
import pino from 'pino';
import { Observable, ReplaySubject, map } from 'rxjs';
import { Limitador } from '../auth/limitador.js';
import { claveDeTelefono, telefonoParaWhatsapp } from '../auth/telefono.js';
import { ImagenesService } from '../comercio/imagenes.service.js';
import { PedidosAMedidaService } from '../comercio/pedidos-a-medida.service.js';
import type { Env } from '../config/env.js';
import { ConversationService } from '../conversation/conversation.service.js';
import type { ImagenAEnviar } from '../conversation/ventas/imagenes-de-la-vuelta.js';
import { avisoWhatsappCaido, avisoWhatsappParaVolverAVincular, type Aviso } from '../notificaciones/avisos.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { avisarASentry } from '../observabilidad/aviso-a-sentry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { VueltaCancelada, type Cancelacion } from '../conversation/cancelacion.js';
import { AgrupadorDeRafagas } from './agrupador-rafagas.js';
import { CacheConVencimiento, MensajesEnviados, TTL_REINTENTOS_MS } from './caches.js';
import {
  MAX_CARACTERES_RAFAGA,
  RENOVAR_ESCRIBIENDO_MS,
  demoraDeEscritura,
  demoraRestante,
  partirEnMensajes,
} from './ritmo-humano.js';
import { PREFIJO_TIEMPOS, demoraDeEntrega, resumenDeRafaga, timestampEnMs } from './metricas.js';
import {
  MINUTOS_CAIDO_PARA_AVISAR,
  correspondeAvisarCaida,
  demoraDeReconexion,
  politicaDeCierre,
} from './reconexion.js';
import { copiarSesion, estaVinculado, extraerTelefono, usePrismaAuthState } from './whatsapp-auth-state.js';
import type { LinkEvent, WhatsappStatus } from './whatsapp.types.js';

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

/**
 * Un mensaje de cliente esperando a que termine su ráfaga. Viaja con su socket
 * para contestar por el mismo. `enviadoEn` (el timestamp de WhatsApp) y
 * `recibidoEn` (cuándo nos lo entregó Baileys) son sólo para medir tiempos.
 */
type MensajeEntrante = {
  userId: string;
  remoteJid: string;
  sock: WASocket;
  key: WAMessageKey;
  texto: string;
  enviadoEn: number | null;
  recibidoEn: number;
};

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baileysLogger: pino.Logger;

  private readonly sockets = new Map<string, WASocket>();
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
  private readonly enviados = new MensajesEnviados();
  /** Versión de WhatsApp Web con la que se conecta; se refresca cada VIGENCIA_VERSION_WA_MS. */
  private versionWa: { version: WAVersion; hasta: number } | null = null;
  private consultandoVersion: Promise<WAVersion> | null = null;
  /** Junta los mensajes seguidos de cada chat y los contesta de a una respuesta por vez. */
  private readonly rafagas = new AgrupadorDeRafagas<MensajeEntrante>(
    (_clave, items, cancelacion) => this.contestarRafaga(items, cancelacion),
    // Sólo el userId: el JID del cliente es su teléfono y no va a los logs.
    (clave, error) =>
      this.logger.error(`Fallo procesando mensajes entrantes de ${clave.split('\n')[0]}`, error as Error),
    (item) => item.texto.length,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly conversationService: ConversationService,
    private readonly subscriptionService: SubscriptionService,
    private readonly imagenes: ImagenesService,
    private readonly notificaciones: NotificacionesService,
    private readonly pedidos: PedidosAMedidaService,
  ) {
    this.baileysLogger = pino({
      level: this.config.get('NODE_ENV', { infer: true }) === 'production' ? 'warn' : 'debug',
    });
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
    this.rafagas.cerrar();
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
    // Directo y no por `enviar`: puede ser un código de acceso, que no queda en
    // memoria para reenvíos (la base sólo guarda su hash).
    await sock.sendMessage(jidPropio(telefono), { text: texto });
    return true;
  }

  /**
   * Manda un mensaje del negocio al chat de un cliente (el aviso de pago
   * aprobado) y lo deja en el historial de esa conversación, como si lo
   * hubiera escrito el asistente. false si no hay un socket vinculado.
   */
  async enviarAlCliente(userId: string, remoteJid: string, texto: string): Promise<boolean> {
    const sock = this.sockets.get(userId);
    if (!sock || !estaVinculado(sock.authState.creds)) return false;
    await this.enviar(userId, sock, remoteJid, { text: texto });
    const conversation = await this.prisma.conversation.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: { id: true },
    });
    if (conversation) {
      // Mismo formato que persistir.node.ts para un mensaje del asistente sin tool calls.
      await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'assistant', content: { content: texto } },
      });
    }
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
   * Saca el socket del mapa antes de cerrarlo: desde ahí sus eventos son de un
   * socket viejo y `handleConnectionUpdate` los ignora.
   */
  private async cerrarSocket(userId: string, modo: 'end' | 'logout'): Promise<void> {
    // Lo que un cliente escribió y todavía no se contestó no sale por un socket cerrado.
    this.rafagas.descartar(`${userId}\n`);
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
    sock.ev.on('messages.upsert', (upsert) => {
      this.handleMessagesUpsert(userId, sock, upsert).catch((error: unknown) =>
        this.logger.error(`Fallo procesando mensajes entrantes de ${userId}`, error as Error),
      );
    });
  }

  /**
   * Mensajes entrantes de clientes del negocio (no del dueño): los pasamos al
   * agente conversacional y mandamos su respuesta. Sólo chats 1:1 en vivo —
   * se ignoran grupos, mensajes propios y el historial que llega al conectar.
   * No se contestan de a uno: van a la ráfaga de su chat (ver
   * `AgrupadorDeRafagas`) y salen juntos cuando el cliente deja de escribir.
   *
   * Si se venció el mes de prueba y no hay suscripción, el asistente queda en
   * silencio: no contestamos nada ni marcamos el mensaje como leído, así el
   * dueño lo ve sin leer. La sesión de Baileys sigue vinculada, así que cuando
   * paga vuelve a responder sin re-escanear el QR.
   */
  private async handleMessagesUpsert(
    userId: string,
    sock: WASocket,
    upsert: { messages: WAMessage[]; type: string },
  ): Promise<void> {
    if (upsert.type !== 'notify') return;

    for (const mensaje of upsert.messages) {
      const remoteJid = mensaje.key.remoteJid;
      if (!remoteJid || isJidGroup(remoteJid)) continue;

      const texto = mensaje.message?.conversation ?? mensaje.message?.extendedTextMessage?.text;
      if (mensaje.key.fromMe) {
        // Lo que el dueño contesta desde su teléfono: sólo se guarda en un chat en atención humana.
        if (texto) await this.guardarRespuestaDelDueno(userId, sock, remoteJid, mensaje.key.id, texto);
        continue;
      }
      if (!texto) continue;

      if (!(await this.subscriptionService.asistenteActivo(userId))) {
        this.logger.debug(`Mensaje ignorado: la suscripción de ${userId} está vencida.`);
        continue;
      }

      // Un pedido de este chat lo atiende una persona (LAU-27): el asistente no
      // contesta, ni marca leído, ni muestra "escribiendo…". El mensaje queda
      // guardado para que el dueño lo vea en Ventas y el asistente al retomar.
      if (await this.pedidos.enAtencionHumana(userId, remoteJid)) {
        await this.pedidos
          .guardarMensajeEnPausa(userId, remoteJid, texto.slice(0, MAX_CARACTERES_RAFAGA), 'cliente')
          .catch((error: unknown) =>
            this.logger.error(`No se pudo guardar un mensaje en atención humana de ${userId}: ${(error as Error).message}`),
          );
        continue;
      }

      this.rafagas.agregar(`${userId}\n${remoteJid}`, {
        userId,
        remoteJid,
        sock,
        key: mensaje.key,
        texto: texto.slice(0, MAX_CARACTERES_RAFAGA),
        enviadoEn: timestampEnMs(mensaje.messageTimestamp),
        recibidoEn: Date.now(),
      });
    }
  }

  /**
   * Un mensaje que el dueño escribió desde su teléfono en el chat de un
   * cliente. Si ese chat está en atención humana, se guarda: es la mitad de la
   * charla que el asistente no vio. Se descartan su propio chat (los códigos
   * de acceso) y lo que salió del asistente (`enviados`), que vuelve como eco.
   */
  private async guardarRespuestaDelDueno(
    userId: string,
    sock: WASocket,
    remoteJid: string,
    id: string | null | undefined,
    texto: string,
  ): Promise<void> {
    if (this.enviados.buscar(userId, id)) return;
    const telefono = estaVinculado(sock.authState.creds) ? extraerTelefono(sock.authState.creds) : undefined;
    if (telefono && remoteJid === jidPropio(telefono)) return;
    try {
      if (!(await this.pedidos.enAtencionHumana(userId, remoteJid))) return;
      await this.pedidos.guardarMensajeEnPausa(userId, remoteJid, texto.slice(0, MAX_CARACTERES_RAFAGA), 'dueno');
    } catch (error) {
      this.logger.error(`No se pudo guardar una respuesta del dueño ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Contesta una ráfaga como lo haría una persona: la marca como leída, muestra
   * "escribiendo…" mientras el modelo piensa y manda la respuesta en uno a
   * MAX_PARTES mensajes, cada uno después de lo que tardaría en tipearlo. El
   * tiempo del modelo cuenta como tipeo del primero, así una respuesta lenta
   * no se demora el doble.
   *
   * Si el cliente manda otro mensaje mientras se arma, `responder` corta con
   * VueltaCancelada y no se manda nada: el agrupador la rehace con todo junto.
   * Si ya estaba comprometida, sale igual.
   */
  private async contestarRafaga(items: MensajeEntrante[], cancelacion: Cancelacion): Promise<void> {
    const { userId, remoteJid, sock } = items.at(-1)!;
    const texto = items.map((item) => item.texto).join('\n');

    // Lo cosmético (leído, "escribiendo…") nunca frena la respuesta.
    await sock.readMessages(items.map((item) => item.key)).catch(() => undefined);
    const escribiendo = this.mostrarEscribiendo(sock, remoteJid);
    const inicio = Date.now();
    try {
      const respuesta = await this.conversationService.responder(userId, remoteJid, texto, { cancelacion }).catch(
        (error: unknown) => {
          if (error instanceof VueltaCancelada) {
            this.logger.log(
              `${PREFIJO_TIEMPOS} · ráfaga de ${userId}: descartada tras ${Date.now() - inicio}ms (llegó otro mensaje)`,
            );
          }
          throw error;
        },
      );
      // Mientras esperaba la ráfaga, el chat pasó a una persona: no se contesta nada.
      if (respuesta.enAtencionHumana) return;
      const finModelo = Date.now();
      const partes = partirEnMensajes(respuesta.texto);
      await this.enviarFotos(userId, sock, remoteJid, respuesta.imagenes);
      await this.enviarEnOrden(userId, sock, remoteJid, partes, escribiendo, finModelo - inicio);
      const primero = items[0]!;
      this.logger.log(
        resumenDeRafaga(userId, {
          entregaMs: demoraDeEntrega(primero.enviadoEn, primero.recibidoEn),
          esperaMs: inicio - primero.recibidoEn,
          modeloMs: finModelo - inicio,
          envioMs: Date.now() - finModelo,
          mensajes: items.length,
          partes: partes.length,
        }),
      );
    } finally {
      escribiendo.parar();
    }
  }

  /**
   * Manda las partes de a una y en orden, cada una después de su demora de
   * tipeo. Recursivo y no un bucle con await: cada envío tiene que esperar al
   * anterior, y así lo deja explícito. `transcurrido` (lo que ya tardó el
   * modelo) sólo se descuenta de la primera.
   */
  private async enviarEnOrden(
    userId: string,
    sock: WASocket,
    remoteJid: string,
    partes: string[],
    escribiendo: { renovar: () => void },
    transcurrido: number,
  ): Promise<void> {
    const [parte, ...resto] = partes;
    if (parte === undefined) return;
    // randomInt y no Math.random: es sólo jitter de tipeo, pero así no lo marca el análisis estático.
    const espera = demoraRestante(demoraDeEscritura(parte, randomInt(0, 1001) / 1000), transcurrido);
    if (espera > 0) await esperar(espera);
    await this.enviar(userId, sock, remoteJid, { text: parte });
    if (resto.length === 0) return;
    escribiendo.renovar();
    return this.enviarEnOrden(userId, sock, remoteJid, resto, escribiendo, 0);
  }

  /** "Escribiendo…" en el chat del cliente, renovado antes de que WhatsApp lo apague solo. */
  private mostrarEscribiendo(sock: WASocket, remoteJid: string): { renovar: () => void; parar: () => void } {
    const avisar = (estado: 'composing' | 'paused') => {
      sock.sendPresenceUpdate(estado, remoteJid).catch(() => undefined);
    };
    avisar('composing');
    const intervalo = setInterval(() => avisar('composing'), RENOVAR_ESCRIBIENDO_MS);
    return {
      renovar: () => avisar('composing'),
      parar: () => {
        clearInterval(intervalo);
        avisar('paused');
      },
    };
  }

  /**
   * Las fotos de productos que eligió el asistente de ventas, antes del texto
   * que las acompaña. Una que falla no corta nada: el texto sale igual.
   */
  private async enviarFotos(userId: string, sock: WASocket, remoteJid: string, imagenes: ImagenAEnviar[]): Promise<void> {
    for (const { productoId } of imagenes) {
      try {
        const foto = await this.imagenes.paraEnviar(userId, productoId);
        if (!foto) continue;
        await this.enviar(userId, sock, remoteJid, { image: foto.datos, mimetype: 'image/jpeg', caption: foto.nombre });
      } catch (error) {
        // Sin el JID ni el nombre del producto: sólo ids, como el resto de los logs de Baileys.
        this.logger.error(`No se pudo mandar la foto del producto ${productoId} (cuenta ${userId}): ${(error as Error).message}`);
      }
    }
  }

  /**
   * Toda salida a un cliente pasa por acá: lo enviado queda en `enviados`
   * para que `getMessage` lo encuentre si el cliente pide reenvío.
   */
  private async enviar(userId: string, sock: WASocket, jid: string, contenido: AnyMessageContent): Promise<void> {
    const enviado = await sock.sendMessage(jid, contenido);
    this.enviados.guardar(userId, enviado?.key.id, enviado?.message);
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
