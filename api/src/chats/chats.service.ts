import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type MessageEvent,
} from '@nestjs/common';
import { catchError, distinctUntilChanged, EMPTY, from, interval, map, startWith, switchMap, type Observable } from 'rxjs';
import { Limitador } from '../auth/limitador.js';
import { ESTADOS_ABIERTOS } from '../comercio/ventas.rules.js';
import { aMensajesPublicos } from '../comercio/ventas.types.js';
import { telefonoDeJid } from '../comercio/ventas.rules.js';
import { esConversacionDePrueba, PREFIJO_JID_DE_PRUEBA } from '../conversation/conversation.service.js';
import { Prisma, type Conversation, type Message } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { devolverChat, limpiarNota, tomarChat, type AtencionChat } from './atencion.js';
import type {
  CambiarAtencionDto,
  CambioDeAtencion,
  ChatResumen,
  DetalleChat,
  EnviarMensajeDto,
  ListaChats,
  MensajeChat,
} from './chats.types.js';

/** Chats que muestra la lista: los de actividad más reciente. */
const MAX_CHATS = 100;
/** Mensajes que muestra un chat: los últimos. */
const MAX_MENSAJES = 200;
/** Mensajes desde el panel por cuenta y minuto: frena un doble envío o un script, no a una persona. */
const MAX_ENVIOS_POR_MINUTO = 20;
/** Cada cuánto el stream mira si cambió algo de los chats de la cuenta. */
const INTERVALO_EVENTOS_MS = 2000;

type FilaChat = Pick<Conversation, 'id' | 'remoteJid' | 'nombreCliente' | 'atencion'>;
type UltimoMensaje = Pick<Message, 'conversationId' | 'role' | 'content' | 'createdAt'>;

/**
 * El módulo de Chats (LAU-81): el dueño ve las conversaciones que atiende su
 * asistente, toma o devuelve el control y contesta desde el panel. Todo se
 * filtra por `userId`; el banco de pruebas del Home no aparece.
 */
@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly envios = new Limitador(MAX_ENVIOS_POR_MINUTO, 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async listar(userId: string, ahora: Date = new Date()): Promise<ListaChats> {
    const donde = this.dondeDelDueno(userId);
    const [filas, porAtencion] = await Promise.all([
      this.prisma.conversation.findMany({
        where: donde,
        orderBy: { ultimoMensajeAt: 'desc' },
        take: MAX_CHATS,
        select: { id: true, remoteJid: true, nombreCliente: true, atencion: true },
      }),
      this.prisma.conversation.groupBy({ by: ['atencion'], where: donde, _count: { _all: true } }),
    ]);
    const humana = porAtencion.find((grupo) => grupo.atencion === 'humana')?._count._all ?? 0;
    const todos = porAtencion.reduce((suma, grupo) => suma + grupo._count._all, 0);
    return { chats: await this.resumir(filas, ahora), cuenta: { todos, humana, asistente: todos - humana } };
  }

  async detalle(userId: string, conversationId: string, ahora: Date = new Date()): Promise<DetalleChat> {
    const fila = await this.delDueno(userId, conversationId);
    const filas = await this.prisma.message.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_MENSAJES,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    const mensajes = filas
      .reverse()
      .flatMap((mensaje): MensajeChat[] => aMensajesPublicos([mensaje]).map((publico) => ({ id: mensaje.id, ...publico })));
    const [chat] = await this.resumir([fila], ahora);
    return { chat: chat!, mensajes };
  }

  /**
   * Tomar el control o devolverlo. Al tomarlo se corta la respuesta que el
   * asistente estaba armando. Al devolverlo, si el cliente quedó sin
   * respuesta y el dueño lo pide, el asistente la contesta con la nota como
   * contexto; si no, espera al próximo mensaje.
   */
  async cambiarAtencion(userId: string, conversationId: string, dto: CambiarAtencionDto): Promise<CambioDeAtencion> {
    const fila = await this.delDueno(userId, conversationId);
    const ahora = new Date();
    let contesta = false;
    if (dto.humana) {
      if (await tomarChat(this.prisma, userId, conversationId, ahora)) this.whatsapp.interrumpir(userId, fila.remoteJid);
    } else {
      const nota = dto.contestar ? limpiarNota(dto.nota) : null;
      const devuelto = await this.prisma.$transaction((tx) => devolverChat(tx, userId, conversationId, nota, ahora));
      const pendientes = devuelto && dto.contestar ? await this.sinRespuesta(conversationId) : [];
      if (pendientes.length > 0) {
        contesta = await this.whatsapp.contestarPendientes(userId, fila.remoteJid, pendientes.join('\n')).catch((error: unknown) => {
          this.logger.error(`No se pudo pedir la respuesta del asistente en un chat de ${userId}: ${(error as Error).message}`);
          return false;
        });
      }
    }
    const [chat] = await this.resumir([{ ...fila, atencion: dto.humana ? 'humana' : 'asistente' }], ahora);
    return { chat: chat!, contesta };
  }

  /**
   * Un mensaje del dueño desde el panel. Se guarda con su llave antes de
   * mandarlo: un reintento con la misma llave devuelve el ya guardado y no
   * sale dos veces. Si no sale, se borra para poder reintentar. Escribir pasa
   * el chat al dueño, como escribir desde su teléfono.
   */
  async enviar(userId: string, conversationId: string, dto: EnviarMensajeDto): Promise<MensajeChat> {
    const texto = dto.texto.trim();
    if (!texto) throw new ConflictException('Escribí un mensaje.');
    const fila = await this.delDueno(userId, conversationId);

    const previo = await this.porClave(conversationId, dto.clave);
    if (previo) return previo;
    if (!this.envios.permitir(userId)) {
      throw new HttpException('Mandaste muchos mensajes seguidos. Esperá un minuto.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (await tomarChat(this.prisma, userId, conversationId, new Date())) this.whatsapp.interrumpir(userId, fila.remoteJid);

    let guardado: Message;
    try {
      guardado = await this.prisma.message.create({
        data: { conversationId, role: 'assistant', content: { content: texto, humano: true }, clave: dto.clave },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const mismo = await this.porClave(conversationId, dto.clave);
        if (mismo) return mismo;
      }
      throw error;
    }

    let salio = false;
    try {
      salio = await this.whatsapp.enviarDesdePanel(userId, fila.remoteJid, texto);
    } catch (error) {
      this.logger.error(`No se pudo mandar un mensaje del panel de ${userId}: ${(error as Error).message}`);
    }
    if (!salio) {
      await this.prisma.message.delete({ where: { id: guardado.id } }).catch(() => undefined);
      // El borrado no mueve `ultimoMensajeAt`: se toca el chat para que el stream avise y nadie se quede con el mensaje que no salió.
      await this.prisma.conversation
        .update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
        .catch(() => undefined);
      // 409 y no 5xx: es el estado de la cuenta (WhatsApp sin vincular) y la web muestra el motivo.
      throw new ConflictException('No se pudo mandar: revisá que tu WhatsApp siga vinculado y probá de nuevo.');
    }
    return { id: guardado.id, ...aMensajesPublicos([guardado])[0]! };
  }

  /**
   * Avisa cuando cambia algo de los chats de la cuenta (un mensaje nuevo o
   * quién contesta): la web vuelve a pedir lo que muestra. Mira una firma
   * barata (los últimos cambios) en vez de engancharse a cada lugar que
   * escribe mensajes; `ultimoMensajeAt` lo mantiene un trigger.
   */
  eventos$(userId: string): Observable<MessageEvent> {
    return interval(INTERVALO_EVENTOS_MS).pipe(
      startWith(0),
      switchMap(() => from(this.firma(userId)).pipe(catchError(() => EMPTY))),
      distinctUntilChanged(),
      map((firma) => ({ data: { tipo: 'cambio', firma } })),
    );
  }

  // --- Internos -------------------------------------------------------------------------

  private dondeDelDueno(userId: string): Prisma.ConversationWhereInput {
    // Todas las de prueba: el banco del Home y el probador de envíos.
    return { userId, ultimoMensajeAt: { not: null }, NOT: { remoteJid: { startsWith: PREFIJO_JID_DE_PRUEBA } } };
  }

  /** La conversación del dueño, o 404: nunca la de otro ni el banco de pruebas. */
  private async delDueno(userId: string, conversationId: string): Promise<FilaChat> {
    const fila = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, remoteJid: true, nombreCliente: true, atencion: true },
    });
    if (!fila || esConversacionDePrueba(fila.remoteJid)) throw new NotFoundException('No existe ese chat.');
    return fila;
  }

  private async porClave(conversationId: string, clave: string): Promise<MensajeChat | null> {
    const mensaje = await this.prisma.message.findUnique({
      where: { conversationId_clave: { conversationId, clave } },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return mensaje ? { id: mensaje.id, ...aMensajesPublicos([mensaje])[0]! } : null;
  }

  /** Lo que el cliente escribió después de la última respuesta (del asistente o del dueño). */
  private async sinRespuesta(conversationId: string): Promise<string[]> {
    const recientes = await this.prisma.message.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { role: true, content: true, createdAt: true },
    });
    const pendientes: string[] = [];
    for (const mensaje of recientes) {
      const [publico] = aMensajesPublicos([mensaje]);
      if (!publico) continue;
      if (publico.de !== 'cliente') break;
      pendientes.unshift(publico.texto);
    }
    return pendientes;
  }

  private async firma(userId: string): Promise<string> {
    const [fila] = await this.prisma.$queryRaw<Array<{ firma: Date | null }>>`
      SELECT GREATEST(MAX("ultimoMensajeAt"), MAX("updatedAt")) AS "firma"
      FROM "Conversation" WHERE "userId" = ${userId}
    `;
    return fila?.firma?.toISOString() ?? '';
  }

  /** Arma los resúmenes con tres lecturas en lote: último mensaje, próximo turno y pedido abierto. */
  private async resumir(filas: FilaChat[], ahora: Date): Promise<ChatResumen[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((fila) => fila.id);
    const [ultimos, turnos, ventas] = await Promise.all([
      this.prisma.$queryRaw<UltimoMensaje[]>`
        SELECT c."id" AS "conversationId", m."role", m."content", m."createdAt"
        FROM "Conversation" c
        CROSS JOIN LATERAL (
          SELECT "role", "content", "createdAt" FROM "Message"
          WHERE "conversationId" = c."id" AND "role" IN ('user', 'assistant') AND COALESCE("content"->>'content', '') <> ''
          ORDER BY "createdAt" DESC LIMIT 1
        ) m
        WHERE c."id" = ANY(${ids})
      `,
      this.prisma.turno.findMany({
        where: { conversationId: { in: ids }, estado: 'confirmado', inicio: { gt: ahora } },
        orderBy: { inicio: 'asc' },
        select: { conversationId: true, inicio: true },
      }),
      this.prisma.venta.findMany({
        where: { conversationId: { in: ids }, dePrueba: false, estado: { in: [...ESTADOS_ABIERTOS] } },
        orderBy: { createdAt: 'desc' },
        select: { conversationId: true, estado: true },
      }),
    ]);
    const ultimoDe = new Map(ultimos.map((fila) => [fila.conversationId, aMensajesPublicos([fila])[0] ?? null]));
    const turnoDe = new Map<string, { inicio: Date }>();
    for (const turno of turnos) if (!turnoDe.has(turno.conversationId)) turnoDe.set(turno.conversationId, { inicio: turno.inicio });
    const pedidoDe = new Map<string, { estado: string }>();
    for (const venta of ventas) {
      if (venta.conversationId && !pedidoDe.has(venta.conversationId)) {
        pedidoDe.set(venta.conversationId, { estado: venta.estado });
      }
    }

    return filas.map((fila) => {
      const atencion: AtencionChat = fila.atencion === 'humana' ? 'humana' : 'asistente';
      const ultimo = ultimoDe.get(fila.id) ?? null;
      return {
        id: fila.id,
        nombre: fila.nombreCliente,
        telefono: telefonoDeJid(fila.remoteJid),
        atencion,
        ultimo,
        teEspera: atencion === 'humana' && ultimo?.de === 'cliente',
        turno: turnoDe.get(fila.id) ?? null,
        pedido: pedidoDe.get(fila.id) ?? null,
      };
    });
  }
}
