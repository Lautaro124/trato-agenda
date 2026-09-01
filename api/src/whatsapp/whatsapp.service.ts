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
import { extraerTelefono, usePrismaAuthState } from './whatsapp-auth-state.js';
import type { LinkEvent } from './whatsapp.types.js';

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
  /** Distingue el "connecting" del arranque del socket del "connecting" post-escaneo. */
  private readonly qrMostrado = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly conversationService: ConversationService,
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
    if (socketVivo && socketVivo.authState.creds.registered) {
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
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(userId, update));
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

      const respuesta = await this.conversationService.handleIncoming(userId, remoteJid, texto);
      await sock.sendMessage(remoteJid, { text: respuesta });
    }
  }

  private handleConnectionUpdate(
    userId: string,
    update: Partial<{ connection: 'open' | 'connecting' | 'close'; qr: string; lastDisconnect: { error: unknown } }>,
  ): void {
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
