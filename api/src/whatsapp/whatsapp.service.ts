import { Injectable, Logger, type MessageEvent, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  isJidGroup,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Observable, ReplaySubject, map } from 'rxjs';
import type { Env } from '../config/env.js';
import { ConversationService } from '../conversation/conversation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { estaVinculado, extraerTelefono, usePrismaAuthState } from './whatsapp-auth-state.js';
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

/** Falla recuperable de red, no una desvinculación: reintentamos con backoff. */
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;

/** Forma mínima que necesitamos de un error de desconexión de Baileys (Boom). */
type ErrorConDisconnectCode = { output?: { statusCode?: number } };

function codigoDeDesconexion(error: unknown): number | undefined {
  return (error as ErrorConDisconnectCode | undefined)?.output?.statusCode;
}

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baileysLogger: pino.Logger;

  private readonly sockets = new Map<string, WASocket>();
  private readonly events = new Map<string, ReplaySubject<LinkEvent>>();
  private readonly reconnectAttempts = new Map<string, number>();
  /** Última promesa de `saveCreds` en vuelo por usuario, para no emitir "connected" antes de que persista. */
  private readonly pendingSaves = new Map<string, Promise<void>>();
  /** Distingue el "connecting" del arranque del socket del "connecting" post-escaneo. */
  private readonly qrMostrado = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly conversationService: ConversationService,
    private readonly subscriptionService: SubscriptionService,
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

    if (socketVivo) {
      await socketVivo.end(undefined).catch(() => undefined);
      this.sockets.delete(userId);
    }

    this.reconnectAttempts.delete(userId);
    await this.connect(userId);
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
   * 3. se copia el blob a la cuenta y se reconecta con su `userId`.
   */
  async transferirSesion(desde: string, hacia: string): Promise<void> {
    await (this.pendingSaves.get(desde) ?? Promise.resolve());
    await this.cerrarSocket(desde, 'end');
    await this.cerrarSocket(hacia, 'logout');
    await (this.pendingSaves.get(hacia) ?? Promise.resolve());

    const origen = await this.prisma.whatsappSession.findUniqueOrThrow({ where: { userId: desde } });
    const datos = {
      authState: origen.authState,
      registered: origen.registered,
      phoneNumber: origen.phoneNumber,
      linkedAt: origen.linkedAt,
    };
    await this.prisma.whatsappSession.upsert({
      where: { userId: hacia },
      create: { userId: hacia, ...datos },
      update: datos,
    });
    await this.prisma.whatsappSession.deleteMany({ where: { userId: desde } });
    this.pendingSaves.delete(desde);
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

  private async connect(userId: string): Promise<void> {
    const { state, saveCreds } = await usePrismaAuthState(
      this.prisma,
      userId,
      this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true }),
    );

    const sock = makeWASocket({
      auth: state,
      logger: this.baileysLogger,
      browser: Browsers.appropriate('Trato Agenda'),
    });

    this.sockets.set(userId, sock);
    this.qrMostrado.delete(userId);
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
   *
   * Si se venció el mes de prueba y no hay suscripción, el asistente queda en
   * silencio: no contestamos nada. La sesión de Baileys sigue vinculada, así
   * que cuando el dueño paga vuelve a responder sin re-escanear el QR.
   */
  private async handleMessagesUpsert(
    userId: string,
    sock: WASocket,
    upsert: { messages: WAMessage[]; type: string },
  ): Promise<void> {
    if (upsert.type !== 'notify') return;

    for (const mensaje of upsert.messages) {
      const remoteJid = mensaje.key.remoteJid;
      if (!remoteJid || mensaje.key.fromMe || isJidGroup(remoteJid)) continue;

      const texto = mensaje.message?.conversation ?? mensaje.message?.extendedTextMessage?.text;
      if (!texto) continue;

      if (!(await this.subscriptionService.asistenteActivo(userId))) {
        this.logger.debug(`Mensaje ignorado: la suscripción de ${userId} está vencida.`);
        continue;
      }

      const respuesta = await this.conversationService.handleIncoming(userId, remoteJid, texto);
      await sock.sendMessage(remoteJid, { text: respuesta });
    }
  }

  private async handleConnectionUpdate(
    userId: string,
    update: Partial<{ connection: 'open' | 'connecting' | 'close'; qr: string; lastDisconnect: { error: unknown } }>,
    sock?: WASocket,
  ): Promise<void> {
    // Un socket que ya no es el del usuario (transferido, descartado) no manda más.
    if (sock && this.sockets.get(userId) !== sock) return;

    if (update.qr) {
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
      this.reconnectAttempts.delete(userId);
      this.qrMostrado.delete(userId);
      const sock = this.sockets.get(userId);
      const phoneNumber = sock && extraerTelefono(sock.authState.creds);
      // Esperamos a que el último `creds.update` haya persistido antes de avisar
      // al frontend: si no, /whatsapp/status puede leer `registered: false` justo
      // después de que el usuario ve "conectado".
      await (this.pendingSaves.get(userId) ?? Promise.resolve());
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

    if (codigo === DisconnectReason.loggedOut) {
      this.sockets.delete(userId);
      this.reconnectAttempts.delete(userId);
      this.prisma.whatsappSession.deleteMany({ where: { userId } }).catch((error: unknown) =>
        this.logger.error(`No se pudo borrar la sesión de WhatsApp de ${userId}`, error as Error),
      );
      this.emit(userId, { state: 'error' });
      return;
    }

    if (codigo === DisconnectReason.restartRequired) {
      // Quirk conocido de Baileys justo después del primer pairing: no cuenta
      // como reintento ni se muestra como error.
      this.connect(userId).catch((error: unknown) =>
        this.logger.error(`Fallo al reconectar (restartRequired) a ${userId}`, error as Error),
      );
      return;
    }

    if (codigo === DisconnectReason.connectionReplaced) {
      // Otra sesión se autenticó con las mismas credenciales: no perseguirla.
      this.sockets.delete(userId);
      this.emit(userId, { state: 'error' });
      return;
    }

    // Caso recuperable (red caída, timeout, etc.): reintentar con backoff acotado.
    this.sockets.delete(userId);
    const intentos = (this.reconnectAttempts.get(userId) ?? 0) + 1;
    this.reconnectAttempts.set(userId, intentos);

    if (intentos > MAX_RECONNECT_ATTEMPTS) {
      this.emit(userId, { state: 'error' });
      return;
    }

    setTimeout(
      () =>
        this.connect(userId).catch((error: unknown) =>
          this.logger.error(`Fallo al reconectar a ${userId} (intento ${intentos})`, error as Error),
        ),
      RECONNECT_BASE_DELAY_MS * intentos,
    );
  }

  /** Como `descartar`, pero el SSE sigue abierto para que llegue el error. */
  private async descartarSinCerrarEventos(userId: string): Promise<void> {
    await this.cerrarSocket(userId, 'logout');
    await this.prisma.whatsappSession.deleteMany({ where: { userId } });
    this.pendingSaves.delete(userId);
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
