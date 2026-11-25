import {
  BadRequestException,
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
import { PedidoRechazadoError, VentasService } from '../comercio/ventas.service.js';
import { tipoAsistenteDe } from '../agents/agent-catalog.js';
import { estadoDeChat } from '../performance/lectura.rules.js';
import type { Etapa } from '../performance/etapas.rules.js';
import { RegistroPerformanceService } from '../performance/registro.service.js';
import { esConversacionDePrueba, PREFIJO_JID_DE_PRUEBA } from '../conversation/conversation.service.js';
import { Prisma, type Conversation, type Message } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { devolverChat, limpiarNota, tomarChat, type AtencionChat } from './atencion.js';
import type {
  CambiarAtencionDto,
  CambiarTratoDto,
  CambioDeAtencion,
  ChatResumen,
  DetalleChat,
  EnviarMensajeDto,
  FichaChat,
  IndicadoresChats,
  ListaChats,
  MensajeChat,
  ProductoDeInteres,
} from './chats.types.js';
import { estadoDelTrato, pasoParaTrato, type UltimoPedido } from './trato.rules.js';
import { accionDe, analisisGuardado, temperaturaDe, type AnalisisVenta } from './analisis.rules.js';
import { TEMAS } from '../performance/preguntas.rules.js';

/** De qué habla el chat: el último producto que le interesó o, si no hay, lo que más le importa según el análisis. */
function temaDelChat(producto: string | undefined, analisis: AnalisisVenta | null): ChatResumen['tema'] {
  if (producto) return { tipo: 'producto', texto: producto };
  if (analisis && analisis.tema !== 'otro') return { tipo: 'tema', texto: TEMAS[analisis.tema] };
  return null;
}

/** Chats que muestra la lista: los de actividad más reciente. */
const MAX_CHATS = 100;
/** Mensajes que muestra un chat: los últimos. */
const MAX_MENSAJES = 200;
/** Mensajes desde el panel por cuenta y minuto: frena un doble envío o un script, no a una persona. */
const MAX_ENVIOS_POR_MINUTO = 20;
/** Cada cuánto el stream mira si cambió algo de los chats de la cuenta. */
const INTERVALO_EVENTOS_MS = 2000;
/** Período de los indicadores rápidos de Inicio. */
const DIAS_INDICADORES = 7;
/** Productos de interés que muestra la ficha: los más recientes. */
const MAX_PRODUCTOS_FICHA = 6;

type FilaChat = Pick<Conversation, 'id' | 'remoteJid' | 'telefono' | 'nombreCliente' | 'atencion' | 'tratoCanceladoAt' | 'analisis'>;
const SELECT_FILA = {
  id: true,
  remoteJid: true,
  telefono: true,
  nombreCliente: true,
  atencion: true,
  tratoCanceladoAt: true,
  analisis: true,
} as const;
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
  /** Chats con un cambio de trato en curso: un doble clic no arma dos pedidos (la API corre en una sola réplica). */
  private readonly tratosEnCurso = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly ventas: VentasService,
    private readonly registro: RegistroPerformanceService,
  ) {}

  async listar(userId: string, ahora: Date = new Date()): Promise<ListaChats> {
    const donde = this.dondeDelDueno(userId);
    const [filas, porAtencion] = await Promise.all([
      this.prisma.conversation.findMany({
        where: donde,
        orderBy: { ultimoMensajeAt: 'desc' },
        take: MAX_CHATS,
        select: SELECT_FILA,
      }),
      this.prisma.conversation.groupBy({ by: ['atencion'], where: donde, _count: { _all: true } }),
    ]);
    const humana = porAtencion.find((grupo) => grupo.atencion === 'humana')?._count._all ?? 0;
    const todos = porAtencion.reduce((suma, grupo) => suma + grupo._count._all, 0);
    return { chats: await this.resumir(userId, filas, ahora), cuenta: { todos, humana, asistente: todos - humana } };
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
    const [chat] = await this.resumir(userId, [fila], ahora);
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
    const [chat] = await this.resumir(userId, [{ ...fila, atencion: dto.humana ? 'humana' : 'asistente' }], ahora);
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
   * Los indicadores rápidos de Inicio, de los últimos días: chats nuevos,
   * chats donde el dueño tomó el control y cuántos de los nuevos terminaron
   * en una venta pagada (ventas) o en un turno (agenda).
   */
  async indicadores(userId: string, ahora: Date = new Date()): Promise<IndicadoresChats> {
    const desde = new Date(ahora.getTime() - DIAS_INDICADORES * 24 * 60 * 60_000);
    const donde = this.dondeDelDueno(userId);
    const nuevosDonde: Prisma.ConversationWhereInput = { ...donde, createdAt: { gte: desde } };
    const ventas = await this.esVentas(userId);
    const [nuevos, intervenciones, convertidos] = await Promise.all([
      this.prisma.conversation.count({ where: nuevosDonde }),
      this.prisma.conversation.count({ where: { ...donde, tomadaAt: { gte: desde } } }),
      this.prisma.conversation.count({
        where: {
          ...nuevosDonde,
          ...(ventas ? { ventas: { some: { estado: 'pagada', dePrueba: false } } } : { turnos: { some: {} } }),
        },
      }),
    ]);
    return { dias: DIAS_INDICADORES, nuevos, intervenciones, convertidos, conversionA: ventas ? 'venta' : 'turno' };
  }

  /**
   * Lo que el dueño necesita para cerrar la venta de un chat: el resumen que
   * guarda el asistente, los productos que el cliente vio o pidió con lo que
   * salen hoy (promos, efectivo y cuotas, calculados igual que al vender) y el
   * último pedido.
   */
  async ficha(userId: string, conversationId: string, ahora: Date = new Date()): Promise<FichaChat> {
    const fila = await this.delDueno(userId, conversationId);
    const [conversacion, intereses, pedido] = await Promise.all([
      this.prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { resumen: true } }),
      this.prisma.interesProducto.findMany({
        where: { conversationId, userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { productoId: true, tipo: true },
      }),
      this.ultimoPedido(conversationId),
    ]);

    // Un producto pedido también se vio: se muestra una vez, como pedido.
    const tipoDe = new Map<string, 'vio' | 'pidio'>();
    for (const interes of intereses) {
      if (interes.tipo === 'pidio' || !tipoDe.has(interes.productoId)) tipoDe.set(interes.productoId, interes.tipo === 'pidio' ? 'pidio' : 'vio');
    }
    const ids = [...tipoDe.keys()].slice(0, MAX_PRODUCTOS_FICHA);
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids }, userId, activo: true },
      select: { id: true, nombre: true, precioCentavos: true, moneda: true, plazoEntregaDias: true },
    });
    const porId = new Map(productos.map((producto) => [producto.id, producto]));
    const detalle: ProductoDeInteres[] = [];
    for (const id of ids) {
      const producto = porId.get(id);
      if (!producto) continue;
      const cotizacion = await this.ventas.cotizarFormasDePago(userId, [{ productoId: id, cantidad: 1 }], ahora).catch(() => null);
      if (!cotizacion) continue;
      detalle.push({
        id,
        nombre: producto.nombre,
        tipo: tipoDe.get(id) ?? 'vio',
        moneda: cotizacion.moneda,
        precioListaCentavos: producto.precioCentavos,
        contadoCentavos: cotizacion.contadoCentavos,
        efectivoCentavos: cotizacion.efectivoCentavos,
        planes: cotizacion.planes,
        plazoEntregaDias: producto.plazoEntregaDias,
      });
    }

    const analisis = (await this.esVentas(userId)) ? analisisGuardado(fila.analisis) : null;
    return {
      resumen: conversacion?.resumen ?? null,
      productos: detalle,
      pedido: pedido && { id: pedido.id, estado: pedido.estado, totalCentavos: pedido.totalCentavos, moneda: pedido.moneda },
      trato: estadoDelTrato(pedido, fila.tratoCanceladoAt),
      analisis: analisis && { ...analisis, temperatura: temperaturaDe(analisis.probabilidad) },
    };
  }

  /**
   * El dueño marca el trato del chat: "hecho" crea el pedido a cobrar a mano
   * (si no hay uno abierto), "pagado" lo cobra (o lo crea ya pagado) y
   * "cancelado" cancela el pedido abierto y deja la marca. Los precios salen
   * de la base, como cuando vende el asistente.
   */
  async cambiarTrato(userId: string, conversationId: string, dto: CambiarTratoDto): Promise<ChatResumen> {
    const fila = await this.delDueno(userId, conversationId);
    if (!(await this.esVentas(userId))) throw new ConflictException('El estado del trato es para cuentas que venden.');
    if (this.tratosEnCurso.has(conversationId)) {
      throw new ConflictException('Ya estamos guardando un cambio en este chat. Esperá un momento.');
    }
    this.tratosEnCurso.add(conversationId);
    try {
      const ahora = new Date();
      const pedido = await this.ultimoPedido(conversationId);
      const paso = pasoParaTrato(dto.estado, pedido);
      switch (paso.tipo) {
        case 'rechazar':
          throw new ConflictException(paso.motivo);
        case 'pagar':
          if (!(await this.ventas.marcarPagadaPorElDueno(userId, pedido!.id))) {
            throw new ConflictException('No se pudo marcar como pagado. Recargá y probá de nuevo.');
          }
          break;
        case 'cancelar_pedido':
          await this.ventas.cancelar(userId, pedido!.id, ahora);
          break;
        case 'crear':
          await this.crearPedidoDelDueno(userId, fila, dto, paso.pagado, ahora);
          break;
        case 'nada':
        case 'marcar_cancelado':
          break;
      }
      // La marca sólo vale para "cancelado"; los otros estados la levantan.
      await this.prisma.conversation.updateMany({
        where: { id: conversationId, userId },
        data: { tratoCanceladoAt: dto.estado === 'cancelado' ? ahora : null },
      });
      const actualizada = await this.delDueno(userId, conversationId);
      const [chat] = await this.resumir(userId, [actualizada], ahora);
      return chat!;
    } finally {
      this.tratosEnCurso.delete(conversationId);
    }
  }

  private async crearPedidoDelDueno(
    userId: string,
    fila: FilaChat,
    dto: CambiarTratoDto,
    pagado: boolean,
    ahora: Date,
  ): Promise<void> {
    if (!dto.items || dto.items.length === 0) throw new BadRequestException('Elegí al menos un producto.');
    const telefono = fila.telefono ?? telefonoDeJid(fila.remoteJid);
    let venta;
    try {
      venta = await this.ventas.crearPedido({
        userId,
        conversationId: fila.id,
        remoteJid: fila.remoteJid,
        nombreCliente: fila.nombreCliente ?? (telefono ? `+${telefono}` : 'Cliente de WhatsApp'),
        items: dto.items.map((item) => ({ productoId: item.productoId, cantidad: item.cantidad })),
        medioPago: 'manual',
        formaPago: dto.formaPago ?? null,
        cuotas: dto.formaPago === 'cuotas' ? (dto.cuotas ?? null) : null,
        delDueno: true,
        ahora,
      });
    } catch (error) {
      if (error instanceof PedidoRechazadoError) throw new ConflictException(error.message);
      throw error;
    }
    await this.registro.avanzarPorVenta(venta, 'pedido');
    if (pagado && !(await this.ventas.marcarPagadaPorElDueno(userId, venta.id))) {
      throw new ConflictException('El pedido quedó creado pero no se pudo marcar como pagado. Probá de nuevo.');
    }
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
      select: SELECT_FILA,
    });
    if (!fila || esConversacionDePrueba(fila.remoteJid)) throw new NotFoundException('No existe ese chat.');
    return fila;
  }

  private async esVentas(userId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { tipoAsistente: true } });
    return agent !== null && tipoAsistenteDe(agent) === 'ventas';
  }

  /** El último pedido real del chat (los del banco de pruebas no cuentan). */
  private ultimoPedido(
    conversationId: string,
  ): Promise<(NonNullable<UltimoPedido> & { id: string; totalCentavos: number | null; moneda: string }) | null> {
    return this.prisma.venta.findFirst({
      where: { conversationId, dePrueba: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, estado: true, createdAt: true, totalCentavos: true, moneda: true },
    });
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

  /**
   * Arma los resúmenes con lecturas en lote: último mensaje, próximo turno y
   * pedido abierto; en una cuenta de ventas, además la etapa y el último pedido.
   */
  /**
   * El número de cada chat: el del JID, el guardado o, en un chat LID que
   * todavía no lo tiene, el del mapeo de la sesión de WhatsApp (que se guarda
   * para no volver a buscarlo). Sin número, Inicio muestra "Cliente sin número".
   */
  private async telefonos(userId: string, filas: FilaChat[]): Promise<Map<string, string | null>> {
    const resultado = new Map<string, string | null>();
    await Promise.all(
      filas.map(async (fila) => {
        const conocido = fila.telefono ?? telefonoDeJid(fila.remoteJid);
        if (conocido) {
          resultado.set(fila.id, conocido);
          return;
        }
        const resuelto = await this.whatsapp.telefonoDeLid(userId, fila.remoteJid);
        resultado.set(fila.id, resuelto);
        if (resuelto) {
          await this.prisma.conversation
            .updateMany({ where: { id: fila.id, userId, telefono: null }, data: { telefono: resuelto } })
            // Sólo el tipo: el mensaje de Prisma puede copiar los argumentos, con el número.
            .catch((error: unknown) => this.logger.warn(`No se pudo guardar el número de un chat de ${userId}: ${(error as Error).name}`));
        }
      }),
    );
    return resultado;
  }

  private async resumir(userId: string, filas: FilaChat[], ahora: Date): Promise<ChatResumen[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((fila) => fila.id);
    const [esVentas, telefonoDe] = await Promise.all([this.esVentas(userId), this.telefonos(userId, filas)]);
    const [ultimos, turnos, ventas, etapas, ultimosPedidos, intereses] = await Promise.all([
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
      esVentas
        ? this.prisma.etapaChat.findMany({
            where: { conversationId: { in: ids }, userId },
            select: { conversationId: true, etapa: true, derivado: true, ultimaActividadAt: true },
          })
        : Promise.resolve([]),
      esVentas
        ? this.prisma.venta.findMany({
            where: { conversationId: { in: ids }, dePrueba: false },
            orderBy: { createdAt: 'desc' },
            distinct: ['conversationId'],
            select: { conversationId: true, estado: true, createdAt: true },
          })
        : Promise.resolve([]),
      // El producto más reciente que vio o pidió cada chat: el tema que muestra la lista.
      esVentas
        ? this.prisma.interesProducto.findMany({
            where: { conversationId: { in: ids }, userId, producto: { userId, activo: true } },
            orderBy: { createdAt: 'desc' },
            distinct: ['conversationId'],
            select: { conversationId: true, producto: { select: { nombre: true } } },
          })
        : Promise.resolve([]),
    ]);
    const productoDe = new Map(intereses.map((fila) => [fila.conversationId, fila.producto.nombre]));
    const etapaDe = new Map(etapas.map((fila) => [fila.conversationId, fila]));
    const pedidoFinalDe = new Map(ultimosPedidos.map((fila) => [fila.conversationId, fila]));
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
      const teEspera = atencion === 'humana' && ultimo?.de === 'cliente';
      const venta = ventaDe(etapaDe.get(fila.id), ahora);
      const trato = esVentas ? estadoDelTrato(pedidoFinalDe.get(fila.id) ?? null, fila.tratoCanceladoAt) : null;
      const analisis = esVentas ? analisisGuardado(fila.analisis) : null;
      // Con el trato pagado o cancelado ya no hay nada que estimar.
      const temperatura = analisis && trato !== 'pagado' && trato !== 'cancelado' ? temperaturaDe(analisis.probabilidad) : null;
      const tema = temaDelChat(productoDe.get(fila.id), analisis);
      return {
        id: fila.id,
        nombre: fila.nombreCliente,
        telefono: telefonoDe.get(fila.id) ?? null,
        atencion,
        ultimo,
        teEspera,
        turno: turnoDe.get(fila.id) ?? null,
        pedido: pedidoDe.get(fila.id) ?? null,
        venta,
        trato,
        temperatura,
        tema,
        accion: accionDe({ teEspera, trato, temperatura, abandonado: venta?.estado === 'abandonado' }),
      };
    });
  }
}

function ventaDe(
  fila: { etapa: string; derivado: boolean; ultimaActividadAt: Date } | undefined,
  ahora: Date,
): ChatResumen['venta'] {
  if (!fila) return null;
  const etapa = fila.etapa as Etapa;
  return { etapa, estado: estadoDeChat(etapa, fila.ultimaActividadAt, ahora), derivado: fila.derivado };
}
