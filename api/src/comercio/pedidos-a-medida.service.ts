import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type EventoVenta, type Message, type Presupuesto } from '../generated/prisma/client.js';
import {
  avisoPedidoDerivado,
  avisoPresupuestoAceptado,
  avisoPresupuestoARevisar,
  avisoSolicitudACotizar,
  type Aviso,
} from '../notificaciones/avisos.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroPerformanceService } from '../performance/registro.service.js';
import { MercadoPagoNoAutorizadoError } from '../subscription/mercadopago.client.js';
import { CostosService } from './costos.service.js';
import { leerPolitica, leerReceta, recetaConContenido, type PoliticaCotizacion } from './costos.rules.js';
import { cotizar, type Cotizacion, type CotizacionFallida } from './cotizacion.rules.js';
import { leerCondiciones } from './condiciones-pago.rules.js';
import { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import {
  armarSolicitudDeVenta,
  cambioDeSolicitud,
  enAtencionHumana,
  ETIQUETA_MOTIVO,
  LARGO_MAX_DETALLE_DERIVACION,
  LARGO_MAX_NOTA,
  leerSolicitudDeVenta,
  MAX_A_MEDIDA_ABIERTOS,
  pausaPorCobroManual,
  itemDeCobro,
  renglonDeVariante,
  resumenDeVariante,
  transicionPermitida,
  vencimientoDeCobroAMedida,
  type MotivoDerivacion,
  type SolicitudDeVenta,
  type VarianteDeSolicitud,
} from './pedido-a-medida.rules.js';
import {
  cierreDelPresupuesto,
  LARGO_MAX_NOTA_PRESUPUESTO,
  leerRenglones,
  TOTAL_MAX_CENTAVOS,
  textoDelPresupuesto,
  type OrigenPresupuesto,
  type RenglonPresupuesto,
} from './presupuesto.rules.js';
import { enUnaLinea, leerSolicitud, type RespuestaSolicitud, type SolicitudADemanda } from './solicitud.rules.js';
import { datosParaGuardar, PedidoRechazadoError, VentasService, type VentaConItems } from './ventas.service.js';
import type { DatoCliente, Entrega } from './datos-cliente.rules.js';
import { estadoVisible, telefonoDeJid, type EstadoVenta, type MedioDePago } from './ventas.rules.js';

/** Quién hizo un cambio, para el historial del pedido. */
export type Autor = 'asistente' | 'dueno' | 'sistema';

export type PedidoAMedida = VentaConItems & { presupuestos: Presupuesto[] };

export type DetallePedido = PedidoAMedida & {
  eventos: EventoVenta[];
  /** Lo último de la conversación, para tomar el caso sin pedirle al cliente que repita. */
  mensajes: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>;
};

export type RegistrarSolicitudInput = {
  userId: string;
  conversationId: string | null;
  remoteJid: string | null;
  nombreCliente: string;
  producto: { id: string; nombre: string };
  respuestas: RespuestaSolicitud[];
  resumen: string;
  /** La versión de precio fijo que el cliente usó de base, con lo que quiere distinto. */
  variante?: VarianteDeSolicitud | null;
  cambios?: string | null;
  dePrueba: boolean;
  ahora?: Date;
};

/** Una versión de precio fijo pedida tal cual: se cobra ese precio, sin cotizar. */
export type PedirVarianteInput = {
  userId: string;
  conversationId: string | null;
  remoteJid: string | null;
  nombreCliente: string;
  varianteId: string;
  cantidad: number;
  /** Ya validados por el grafo (validarDatosPedido), como en crearPedido. */
  entrega?: Entrega | null;
  datosCliente?: DatoCliente[];
  dePrueba: boolean;
  ahora?: Date;
};

/** Una variante fija de un producto a medida activo de la cuenta, con lo que hace falta para pedirla. */
export type VarianteParaPedir = {
  productoId: string;
  nombreProducto: string;
  varianteId: string;
  nombreVariante: string;
  precioCentavos: number;
};

export type ResultadoSolicitud = {
  venta: PedidoAMedida;
  /** false si ya había un pedido abierto de ese producto y se actualizó. */
  nueva: boolean;
  /** true si se crearon o cambiaron las respuestas (hay que cotizar de nuevo). */
  cambio: boolean;
};

export type DerivarInput = {
  userId: string;
  /** El pedido a derivar; sin él, el más reciente abierto de la conversación o uno nuevo. */
  ventaId?: string | null;
  conversationId: string | null;
  remoteJid: string | null;
  nombreCliente: string | null;
  motivo: MotivoDerivacion;
  detalle: string | null;
  autor: Autor;
  dePrueba: boolean;
  ahora?: Date;
};

/** Lo que da la receta antes de anotar la solicitud (null = este producto lo cotiza el dueño). */
export type CotizacionPrevia = { politica: Exclude<PoliticaCotizacion, 'manual'>; resultado: Cotizacion | CotizacionFallida };

/** Qué pasó con la cotización después de anotar la solicitud. */
export type CotizacionDeSolicitud =
  | { modo: 'automatica'; texto: string }
  | { modo: 'revision' }
  | { modo: 'manual' }
  | { modo: 'sin_cambio' };

export type NuevoPresupuestoInput = {
  renglones: RenglonPresupuesto[];
  totalCentavos: number;
  estimativo: boolean;
  detalleAlCliente: boolean;
  nota?: string | null;
  datos?: Prisma.InputJsonValue;
};

/** Mensajes de la conversación que trae el detalle de un pedido. */
const MENSAJES_EN_DETALLE = 40;

/** Estados en los que se puede preparar o cambiar un presupuesto. */
const COTIZABLES: ReadonlySet<string> = new Set(['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida']);

const INCLUIR = { items: true, presupuestos: { orderBy: { version: 'asc' } } } as const satisfies Prisma.VentaInclude;

type Tx = Prisma.TransactionClient;

/** Las columnas de montos son `Int` de Postgres. */
const MAX_INT_POSTGRES = 2_147_483_647;

/**
 * Pedidos a medida (LAU-24/26/27/28): la solicitud del cliente, sus
 * presupuestos versionados, el cobro con lo que ya existe (Mercado Pago o a
 * coordinar) y la atención humana. Todo sobre la misma `Venta`, con el
 * historial en `EventoVenta`. Cada método filtra por `userId`: un pedido de
 * otro comercio es como si no existiera.
 */
@Injectable()
export class PedidosAMedidaService {
  private readonly logger = new Logger(PedidosAMedidaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ventas: VentasService,
    private readonly cuentas: CuentaMercadoPagoService,
    private readonly notificaciones: NotificacionesService,
    private readonly costos: CostosService,
    private readonly registro: RegistroPerformanceService,
  ) {}

  // --- Lectura -----------------------------------------------------------------

  /** Un pedido a medida del dueño con sus presupuestos, o null. */
  buscar(userId: string, ventaId: string): Promise<PedidoAMedida | null> {
    return this.prisma.venta.findFirst({ where: { id: ventaId, userId, tipo: 'a_medida' }, include: INCLUIR });
  }

  /** El detalle para el panel: presupuestos, historial y lo último que se habló. */
  async detalle(userId: string, ventaId: string): Promise<DetallePedido | null> {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, userId },
      include: { ...INCLUIR, eventos: { orderBy: { createdAt: 'asc' } } },
    });
    if (!venta) return null;
    const mensajes = venta.conversationId
      ? await this.prisma.message.findMany({
          where: { conversationId: venta.conversationId, role: { in: ['user', 'assistant'] } },
          select: { role: true, content: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: MENSAJES_EN_DETALLE,
        })
      : [];
    return { ...venta, mensajes: mensajes.reverse() };
  }

  /** Los pedidos a medida de una conversación, para el contexto del asistente. */
  deConversacion(conversationId: string, limite = MAX_A_MEDIDA_ABIERTOS + 2): Promise<PedidoAMedida[]> {
    return this.prisma.venta.findMany({
      where: { conversationId, tipo: 'a_medida' },
      include: INCLUIR,
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  /**
   * ¿El asistente tiene que callarse en este chat? Sí mientras algún pedido
   * de la conversación esté en atención humana y siga abierto.
   */
  async enAtencionHumana(userId: string, remoteJid: string): Promise<boolean> {
    const venta = await this.prisma.venta.findFirst({
      where: {
        userId,
        atencion: 'humana',
        estado: { in: ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] },
        conversation: { remoteJid },
      },
      select: { atencion: true, estado: true },
    });
    return venta !== null && enAtencionHumana(venta);
  }

  /** Los pedidos que esperan a una persona, para "Te esperan" del panel. */
  esperandoAtencion(userId: string): Promise<PedidoAMedida[]> {
    return this.prisma.venta.findMany({
      where: {
        userId,
        atencion: 'humana',
        estado: { in: ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] },
      },
      include: INCLUIR,
      orderBy: { derivadaAt: 'asc' },
      take: 50,
    });
  }

  // --- Solicitud ----------------------------------------------------------------

  /**
   * El producto de una solicitud, del dueño y activo, con sus preguntas. Uno
   * de stock vuelve con `solicitud` null: ese no se cotiza.
   */
  async productoParaSolicitud(
    userId: string,
    productoId: string,
  ): Promise<{ id: string; nombre: string; solicitud: SolicitudADemanda | null } | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { id: true, nombre: true, solicitud: true },
    });
    if (!producto) return null;
    // Null en uno de stock: ese no se cotiza, se vende con crear_pedido.
    return { id: producto.id, nombre: producto.nombre, solicitud: leerSolicitud(producto.solicitud) };
  }

  /**
   * Registra lo que pidió el cliente como pedido a medida "a cotizar". Si la
   * conversación ya tiene uno abierto del mismo producto, lo actualiza: un
   * cambio en las respuestas invalida el presupuesto que hubiera (y su link).
   * Uno de una versión pedida tal cual (pedirVariante) no cuenta: queda como está.
   */
  async registrarSolicitud(input: RegistrarSolicitudInput): Promise<ResultadoSolicitud> {
    const ahora = input.ahora ?? new Date();
    const nombreCliente = input.nombreCliente.trim();
    if (!nombreCliente) throw new PedidoRechazadoError('Falta el nombre de la persona: preguntáselo antes.');
    const solicitud = armarSolicitudDeVenta({
      productoId: input.producto.id,
      nombreProducto: input.producto.nombre,
      respuestas: input.respuestas,
      resumen: input.resumen,
      variante: input.variante ?? null,
      cambios: input.cambios ?? null,
    });

    const { ventaId, nueva, cambio, linkViejo } = await this.prisma.$transaction(async (tx) => {
      const abiertas = input.conversationId
        ? await tx.venta.findMany({
            where: {
              conversationId: input.conversationId,
              tipo: 'a_medida',
              estado: { in: ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      // Una versión pedida tal cual ya tiene su precio y su cobro: es otro pedido, no se reabre.
      const existente = abiertas.find((venta) => {
        const anterior = leerSolicitudDeVenta(venta.solicitud);
        return anterior?.productoId === input.producto.id && !(anterior.variante && !anterior.cambios);
      });

      if (existente) {
        const anterior = leerSolicitudDeVenta(existente.solicitud);
        const cambio = !anterior || cambioDeSolicitud(anterior, solicitud);
        if (!cambio) return { ventaId: existente.id, nueva: false, cambio: false, linkViejo: null };
        await this.reabrirParaCotizar(tx, existente.id, existente.estado as EstadoVenta, 'asistente');
        await tx.venta.update({
          where: { id: existente.id },
          data: { solicitud, nombreCliente },
        });
        return { ventaId: existente.id, nueva: false, cambio: true, linkViejo: existente.mpPreferenceId };
      }

      if (abiertas.length >= MAX_A_MEDIDA_ABIERTOS) {
        throw new PedidoRechazadoError(
          `Este cliente ya tiene ${abiertas.length} pedidos a medida abiertos. Que avance o cancele alguno antes de pedir otro.`,
        );
      }
      const venta = await tx.venta.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          tipo: 'a_medida',
          estado: 'a_cotizar',
          nombreCliente,
          telefonoCliente: input.remoteJid ? telefonoDeJid(input.remoteJid) : null,
          solicitud,
          dePrueba: input.dePrueba,
          eventos: { create: { tipo: 'estado', de: null, a: 'a_cotizar', autor: 'asistente' } },
        },
      });
      if (input.conversationId) {
        await tx.conversation.update({ where: { id: input.conversationId }, data: { nombreCliente } });
      }
      return { ventaId: venta.id, nueva: true, cambio: true, linkViejo: null };
    });

    if (linkViejo) await this.ventas.vencerLink(input.userId, linkViejo, ahora);
    const venta = await this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });
    return { venta, nueva, cambio };
  }

  /**
   * Una variante fija (activa) de un producto a medida activo de la cuenta, o
   * null. Una variante de un producto con stock no sirve: esa se vende con
   * crear_pedido.
   */
  async varianteParaPedir(userId: string, varianteId: string): Promise<VarianteParaPedir | null> {
    const variante = await this.prisma.variante.findFirst({
      where: { id: varianteId, activo: true, producto: { userId, activo: true } },
      select: { id: true, nombre: true, precioCentavos: true, producto: { select: { id: true, nombre: true, solicitud: true } } },
    });
    if (!variante || !leerSolicitud(variante.producto.solicitud)) return null;
    return {
      productoId: variante.producto.id,
      nombreProducto: variante.producto.nombre,
      varianteId: variante.id,
      nombreVariante: variante.nombre,
      precioCentavos: variante.precioCentavos,
    };
  }

  /**
   * El cliente pide tal cual una versión de precio fijo: es el mismo pedido a
   * medida de siempre, pero ya cotizado con ese precio. Se anota, se arma y
   * manda el presupuesto (origen asistente, un renglón) y se cobra con
   * `cobrar` (link de Mercado Pago o a coordinar), así el webhook, la
   * conciliación y el panel no necesitan nada nuevo. Si en la conversación ya
   * hay uno igual esperando el pago, se devuelve ese en vez de duplicarlo.
   */
  async pedirVariante(input: PedirVarianteInput): Promise<PedidoAMedida> {
    const ahora = input.ahora ?? new Date();
    const nombreCliente = input.nombreCliente.trim();
    if (!nombreCliente) throw new PedidoRechazadoError('Falta el nombre de la persona: preguntáselo antes.');
    const elegida = await this.varianteParaPedir(input.userId, input.varianteId);
    if (!elegida) {
      throw new PedidoRechazadoError('Esa versión ya no está en el catálogo. Volvé a buscar el producto.');
    }
    const variante: VarianteDeSolicitud = {
      id: elegida.varianteId,
      nombre: elegida.nombreVariante,
      precioCentavos: elegida.precioCentavos,
      cantidad: input.cantidad,
    };
    const total = variante.precioCentavos * variante.cantidad;
    if (total <= 0 || total > TOTAL_MAX_CENTAVOS || total > MAX_INT_POSTGRES) {
      throw new PedidoRechazadoError('Ese pedido no se puede cobrar así: pasáselo al equipo con derivar_a_persona.');
    }
    const solicitud = armarSolicitudDeVenta({
      productoId: elegida.productoId,
      nombreProducto: elegida.nombreProducto,
      respuestas: [],
      resumen: `${variante.cantidad > 1 ? `${variante.cantidad} × ` : ''}${variante.nombre}, tal cual`,
      variante,
      cambios: null,
    });

    const { ventaId, yaEstaba } = await this.prisma.$transaction(async (tx) => {
      const abiertas = input.conversationId
        ? await tx.venta.findMany({
            where: {
              conversationId: input.conversationId,
              tipo: 'a_medida',
              estado: { in: ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const igual = abiertas.find((venta) => {
        const anterior = leerSolicitudDeVenta(venta.solicitud);
        return (
          anterior?.variante?.id === variante.id &&
          anterior.variante.cantidad === variante.cantidad &&
          !anterior.cambios &&
          estadoVisible(venta, ahora) === 'pendiente_pago'
        );
      });
      if (igual) return { ventaId: igual.id, yaEstaba: true };
      if (abiertas.length >= MAX_A_MEDIDA_ABIERTOS) {
        throw new PedidoRechazadoError(
          `Este cliente ya tiene ${abiertas.length} pedidos a medida abiertos. Que avance o cancele alguno antes de pedir otro.`,
        );
      }
      const venta = await tx.venta.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          tipo: 'a_medida',
          estado: 'a_cotizar',
          nombreCliente,
          telefonoCliente: input.remoteJid ? telefonoDeJid(input.remoteJid) : null,
          solicitud,
          entrega: input.entrega ?? null,
          ...datosParaGuardar(input.datosCliente),
          dePrueba: input.dePrueba,
          eventos: { create: { tipo: 'estado', de: null, a: 'a_cotizar', autor: 'asistente' } },
        },
      });
      if (input.conversationId) {
        await tx.conversation.update({ where: { id: input.conversationId }, data: { nombreCliente } });
      }
      return { ventaId: venta.id, yaEstaba: false };
    });
    if (yaEstaba) return this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });

    const creado = await this.crearPresupuesto(
      input.userId,
      ventaId,
      {
        renglones: [renglonDeVariante(variante)],
        totalCentavos: total,
        estimativo: false,
        detalleAlCliente: false,
        datos: { variante: { id: variante.id, cantidad: variante.cantidad } },
      },
      'asistente',
    );
    if (!creado) throw new PedidoRechazadoError('No se pudo anotar el pedido.');
    await this.enviarPresupuesto(input.userId, ventaId, creado.presupuesto.id, {
      autor: 'asistente',
      mandarAlCliente: false,
      vigenciaDias: null,
      ahora,
    });
    return this.cobrar(input.userId, ventaId, {
      autor: 'asistente',
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ahora,
    });
  }

  /**
   * La cotización que daría la receta del producto con estas respuestas, sin
   * guardar nada. Sirve para saber, antes de anotar la solicitud, si le falta
   * contestar algo que la receta necesita (y entonces el asistente pregunta).
   */
  async cotizacionPrevia(
    userId: string,
    productoId: string,
    respuestas: RespuestaSolicitud[],
  ): Promise<CotizacionPrevia | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { solicitud: true, receta: true, politicaCotizacion: true },
    });
    if (!producto) return null;
    const politica = leerPolitica(producto.politicaCotizacion);
    const solicitud = leerSolicitud(producto.solicitud);
    const receta = leerReceta(producto.receta, solicitud);
    if (politica === 'manual' || !recetaConContenido(receta)) return null;
    const [insumos, config] = await Promise.all([this.costos.todosLosInsumos(userId), this.costos.config(userId)]);
    return { politica, resultado: cotizar({ receta, solicitud, insumos, config, respuestas }) };
  }

  /**
   * Después de anotar la solicitud: si cambió y la receta pudo cotizarla, el
   * presupuesto se arma con origen "asistente" y, según el producto, se manda
   * (automática: lo devuelve para que el asistente lo pase tal cual) o queda
   * para que el dueño lo apruebe. Si no, el dueño se entera de que hay que
   * cotizarla, con el motivo cuando la receta no alcanzó.
   */
  async cotizarSolicitud(resultado: ResultadoSolicitud, previa: CotizacionPrevia | null): Promise<CotizacionDeSolicitud> {
    if (!resultado.cambio) return { modo: 'sin_cambio' };
    const { venta } = resultado;
    if (!previa || !previa.resultado.ok) {
      const motivo = previa && !previa.resultado.ok ? `El asistente no pudo cotizarlo solo: ${previa.resultado.motivo}` : null;
      if (previa) {
        await this.prisma.eventoVenta.create({
          data: { ventaId: venta.id, tipo: 'derivacion', a: 'a_cotizar', motivo: 'sin_reglas', autor: 'asistente' },
        });
      }
      await this.avisarParaCotizar(venta, motivo);
      return { modo: 'manual' };
    }
    const config = await this.costos.config(venta.userId);
    const cotizacion = previa.resultado;
    const creado = await this.crearPresupuesto(
      venta.userId,
      venta.id,
      {
        renglones: cotizacion.renglones,
        totalCentavos: cotizacion.totalCentavos,
        estimativo: config.estimativo,
        detalleAlCliente: config.desgloseAlCliente === 'detallado',
        datos: { valores: cotizacion.valores, respuestas: leerSolicitudDeVenta(venta.solicitud)?.respuestas ?? [] },
      },
      'asistente',
    );
    if (!creado) return { modo: 'manual' };
    if (previa.politica === 'revision') {
      await this.avisarParaRevisar(creado.venta, cotizacion.totalCentavos);
      return { modo: 'revision' };
    }
    const enviado = await this.enviarPresupuesto(venta.userId, venta.id, creado.presupuesto.id, {
      autor: 'asistente',
      mandarAlCliente: false,
      vigenciaDias: config.vigenciaDias,
    });
    return enviado ? { modo: 'automatica', texto: enviado.texto } : { modo: 'manual' };
  }

  /**
   * El dueño arma un presupuesto con la receta del producto y las respuestas
   * del pedido: queda como borrador para que lo revise, edite o mande.
   */
  async presupuestoDesdeReceta(userId: string, ventaId: string): Promise<PedidoAMedida | null> {
    const venta = await this.buscar(userId, ventaId);
    if (!venta) return null;
    const solicitud = leerSolicitudDeVenta(venta.solicitud);
    if (!solicitud?.productoId) throw new PedidoRechazadoError('Este pedido no tiene un producto con receta.');
    const conReceta = await this.cotizacionConReceta(userId, solicitud.productoId, solicitud.respuestas);
    if (!conReceta) throw new PedidoRechazadoError('Ese producto no tiene receta: cargala en Productos o armá el presupuesto a mano.');
    if (!conReceta.ok) throw new PedidoRechazadoError(`No se puede calcular con la receta: ${conReceta.motivo}`);
    const config = await this.costos.config(userId);
    const creado = await this.crearPresupuesto(
      userId,
      ventaId,
      {
        renglones: conReceta.renglones,
        totalCentavos: conReceta.totalCentavos,
        estimativo: config.estimativo,
        detalleAlCliente: config.desgloseAlCliente === 'detallado',
        datos: { valores: conReceta.valores, respuestas: solicitud.respuestas },
      },
      'asistente',
    );
    return creado?.venta ?? null;
  }

  /** Igual que la previa pero aunque el producto lo cotice el dueño: para el botón del panel. */
  private async cotizacionConReceta(
    userId: string,
    productoId: string,
    respuestas: RespuestaSolicitud[],
  ): Promise<Cotizacion | CotizacionFallida | null> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId },
      select: { solicitud: true, receta: true },
    });
    const solicitud = leerSolicitud(producto?.solicitud ?? null);
    const receta = leerReceta(producto?.receta ?? null, solicitud);
    if (!recetaConContenido(receta)) return null;
    const [insumos, config] = await Promise.all([this.costos.todosLosInsumos(userId), this.costos.config(userId)]);
    return cotizar({ receta, solicitud, insumos, config, respuestas });
  }

  /** Avisa al dueño que hay una solicitud para cotizar (con el motivo, si el asistente no pudo). */
  async avisarParaCotizar(venta: PedidoAMedida, motivo: string | null = null): Promise<void> {
    const solicitud = leerSolicitudDeVenta(venta.solicitud);
    await this.avisar(
      venta.userId,
      avisoSolicitudACotizar({
        ...this.avisable(venta, solicitud),
        resumen: solicitud?.resumen ?? '',
        motivo,
        variante: resumenDeVariante(solicitud) || null,
      }),
    );
  }

  // --- Atención humana ------------------------------------------------------------

  /**
   * Pasa un pedido a una persona: el asistente deja de contestar en ese chat.
   * Sin `ventaId` toma el pedido abierto más reciente de la conversación, y si
   * no hay ninguno crea uno "solicitado" con el detalle, así el lead queda
   * atado a un pedido y no se pierde.
   */
  async derivar(input: DerivarInput): Promise<PedidoAMedida> {
    const ahora = input.ahora ?? new Date();
    const detalle = input.detalle ? enUnaLinea(input.detalle).slice(0, LARGO_MAX_DETALLE_DERIVACION) || null : null;

    const ventaId = await this.prisma.$transaction(async (tx) => {
      let venta = input.ventaId
        ? await tx.venta.findFirst({
            where: {
              id: input.ventaId,
              userId: input.userId,
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            },
          })
        : input.conversationId
          ? await tx.venta.findFirst({
              where: {
                conversationId: input.conversationId,
                userId: input.userId,
                tipo: 'a_medida',
                estado: { in: ['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'] },
              },
              orderBy: { createdAt: 'desc' },
            })
          : null;
      if (input.ventaId && !venta) throw new PedidoRechazadoError('No encontré ese pedido en esta conversación.');
      if (venta && !['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida'].includes(venta.estado)) {
        throw new PedidoRechazadoError('Ese pedido ya está cerrado (pagado o cancelado).');
      }

      if (!venta) {
        venta = await tx.venta.create({
          data: {
            userId: input.userId,
            conversationId: input.conversationId,
            tipo: 'a_medida',
            estado: 'solicitado',
            nombreCliente: input.nombreCliente?.trim() || null,
            telefonoCliente: input.remoteJid ? telefonoDeJid(input.remoteJid) : null,
            solicitud: armarSolicitudDeVenta({
              productoId: null,
              nombreProducto: null,
              respuestas: [],
              resumen: detalle ?? '',
            }),
            dePrueba: input.dePrueba,
            eventos: { create: { tipo: 'estado', de: null, a: 'solicitado', autor: input.autor } },
          },
        });
      }
      await tx.venta.update({
        where: { id: venta.id },
        data: {
          atencion: 'humana',
          derivadaAt: ahora,
          motivoDerivacion: input.motivo,
          detalleDerivacion: detalle,
          devueltaAt: null,
          notaDevolucion: null,
        },
      });
      await tx.eventoVenta.create({
        data: { ventaId: venta.id, tipo: 'derivacion', de: venta.atencion, a: 'humana', motivo: input.motivo, autor: input.autor },
      });
      return venta.id;
    });

    const venta = await this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });
    if (venta.conversationId && !venta.dePrueba) await this.registro.marcarDerivado(venta.userId, venta.conversationId);
    if (input.autor !== 'dueno') {
      await this.avisar(
        input.userId,
        avisoPedidoDerivado({
          ...this.avisable(venta, leerSolicitudDeVenta(venta.solicitud)),
          motivo: ETIQUETA_MOTIVO[input.motivo],
          detalle,
        }),
      );
    }
    return venta;
  }

  /**
   * El dueño le devuelve el chat al asistente. Se devuelven todos los pedidos
   * de esa conversación que estaban en atención humana: la pausa es del chat.
   */
  async devolver(userId: string, ventaId: string, nota: string | null, ahora: Date = new Date()): Promise<PedidoAMedida | null> {
    const venta = await this.prisma.venta.findFirst({ where: { id: ventaId, userId } });
    if (!venta) return null;
    const limpia = nota ? enUnaLinea(nota).slice(0, LARGO_MAX_NOTA) || null : null;
    const delChat = await this.prisma.venta.findMany({
      where: venta.conversationId
        ? { userId, conversationId: venta.conversationId, atencion: 'humana' }
        : { id: venta.id, atencion: 'humana' },
      select: { id: true },
    });
    await this.prisma.$transaction([
      ...delChat.map(({ id }) =>
        this.prisma.venta.update({
          where: { id },
          data: { atencion: 'asistente', devueltaAt: ahora, notaDevolucion: limpia },
        }),
      ),
      ...delChat.map(({ id }) =>
        this.prisma.eventoVenta.create({ data: { ventaId: id, tipo: 'devolucion', de: 'humana', a: 'asistente', autor: 'dueno' } }),
      ),
    ]);
    return this.buscarCualquiera(userId, ventaId);
  }

  // --- Presupuestos ----------------------------------------------------------------

  /**
   * Guarda un presupuesto nuevo como borrador (versión siguiente). Todavía no
   * le llega al cliente ni cambia el estado del pedido: eso es `enviar`.
   */
  async crearPresupuesto(
    userId: string,
    ventaId: string,
    datos: NuevoPresupuestoInput,
    origen: OrigenPresupuesto,
  ): Promise<{ venta: PedidoAMedida; presupuesto: Presupuesto } | null> {
    const resultado = await this.prisma.$transaction(async (tx) => {
      const venta = await this.bloquear(tx, userId, ventaId);
      if (!venta || venta.tipo !== 'a_medida') return null;
      if (!COTIZABLES.has(venta.estado)) throw new PedidoRechazadoError('Ese pedido ya está cerrado: no se puede cotizar.');
      const ultima = await tx.presupuesto.findFirst({ where: { ventaId }, orderBy: { version: 'desc' }, select: { version: true } });
      // Un borrador anterior sin mandar queda descartado: hay uno solo por revisar.
      await tx.presupuesto.updateMany({ where: { ventaId, estado: 'borrador' }, data: { estado: 'descartado' } });
      const presupuesto = await tx.presupuesto.create({
        data: {
          ventaId,
          version: (ultima?.version ?? 0) + 1,
          origen,
          estado: 'borrador',
          renglones: datos.renglones,
          totalCentavos: datos.totalCentavos,
          estimativo: datos.estimativo,
          detalleAlCliente: datos.detalleAlCliente,
          nota: datos.nota ? datos.nota.trim().slice(0, LARGO_MAX_NOTA_PRESUPUESTO) || null : null,
          ...(datos.datos === undefined ? {} : { datos: datos.datos }),
        },
      });
      await tx.eventoVenta.create({
        data: { ventaId, tipo: 'presupuesto', a: `v${presupuesto.version} borrador`, autor: origen },
      });
      return presupuesto;
    });
    if (!resultado) return null;
    const venta = await this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });
    return { venta, presupuesto: resultado };
  }

  /** Avisa al dueño que el asistente armó un presupuesto y espera que lo apruebe. */
  async avisarParaRevisar(venta: PedidoAMedida, totalCentavos: number): Promise<void> {
    await this.avisar(
      venta.userId,
      avisoPresupuestoARevisar({ ...this.avisable(venta, leerSolicitudDeVenta(venta.solicitud)), totalCentavos }),
    );
  }

  /** El dueño descarta un borrador sin mandarlo. */
  async descartarPresupuesto(userId: string, ventaId: string, presupuestoId: string): Promise<PedidoAMedida | null> {
    const { count } = await this.prisma.presupuesto.updateMany({
      where: { id: presupuestoId, ventaId, estado: 'borrador', venta: { userId } },
      data: { estado: 'descartado' },
    });
    if (count === 0) return null;
    return this.buscar(userId, ventaId);
  }

  /**
   * Habilita un borrador: pasa a ser el presupuesto vigente y el pedido queda
   * "cotizado" con ese total. El anterior queda "reemplazado" y, si ya tenía
   * un link de pago, el link se vence: no se puede cobrar un precio viejo.
   * Con `mandarAlCliente`, el texto le llega al chat (cuando lo manda el
   * panel); el asistente, en cambio, lo pasa en su propia respuesta.
   */
  async enviarPresupuesto(
    userId: string,
    ventaId: string,
    presupuestoId: string,
    opciones: { autor: Autor; mandarAlCliente: boolean; vigenciaDias?: number | null; ahora?: Date },
  ): Promise<{ venta: PedidoAMedida; texto: string; mandado: boolean } | null> {
    const ahora = opciones.ahora ?? new Date();
    const resultado = await this.prisma.$transaction(async (tx) => {
      const venta = await this.bloquear(tx, userId, ventaId);
      if (!venta || venta.tipo !== 'a_medida') return null;
      const presupuesto = await tx.presupuesto.findFirst({ where: { id: presupuestoId, ventaId } });
      if (!presupuesto) return null;
      if (presupuesto.estado !== 'borrador') throw new PedidoRechazadoError('Ese presupuesto ya se mandó o se descartó.');
      const estado = estadoVisible(venta, ahora);
      if (!transicionPermitida('a_medida', estado, 'cotizado')) {
        throw new PedidoRechazadoError('Ese pedido ya está cerrado: no se le puede mandar un presupuesto.');
      }
      await tx.presupuesto.updateMany({ where: { ventaId, estado: 'enviado' }, data: { estado: 'reemplazado' } });
      await tx.presupuesto.update({ where: { id: presupuestoId }, data: { estado: 'enviado', enviadoAt: ahora } });
      await tx.itemVenta.deleteMany({ where: { ventaId } });
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          estado: 'cotizado',
          totalCentavos: presupuesto.totalCentavos,
          moneda: presupuesto.moneda,
          medioPago: null,
          reservaVenceAt: null,
          linkPago: null,
          mpPreferenceId: null,
        },
      });
      await tx.eventoVenta.createMany({
        data: [
          { ventaId, tipo: 'presupuesto', a: `v${presupuesto.version} enviado`, autor: opciones.autor },
          ...(venta.estado === 'cotizado' ? [] : [{ ventaId, tipo: 'estado', de: venta.estado, a: 'cotizado', autor: opciones.autor }]),
        ],
      });
      return { presupuesto, linkViejo: venta.mpPreferenceId };
    });
    if (!resultado) return null;
    if (resultado.linkViejo) await this.ventas.vencerLink(userId, resultado.linkViejo, ahora);

    const venta = await this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });
    await this.registro.avanzarPorVenta(venta, 'cotizado');
    const conMercadoPago = (await this.cuentas.tokenDe(userId)) !== null;
    const texto = textoDelPresupuesto(
      {
        renglones: leerRenglones(resultado.presupuesto.renglones),
        totalCentavos: resultado.presupuesto.totalCentavos,
        estimativo: resultado.presupuesto.estimativo,
        detalleAlCliente: resultado.presupuesto.detalleAlCliente,
        nota: resultado.presupuesto.nota,
        vigenciaDias: opciones.vigenciaDias ?? null,
      },
      leerSolicitudDeVenta(venta.solicitud),
      cierreDelPresupuesto(conMercadoPago),
    );
    let mandado = false;
    if (opciones.mandarAlCliente && venta.conversationId && !venta.dePrueba) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: venta.conversationId },
        select: { remoteJid: true },
      });
      if (conversation) mandado = await this.notificaciones.avisarAlCliente(userId, conversation.remoteJid, texto);
    }
    return { venta, texto, mandado };
  }

  // --- Cobro --------------------------------------------------------------------------

  /**
   * Genera el cobro del presupuesto vigente: un único renglón con el total,
   * y el link de Mercado Pago si el comercio lo tiene conectado (o uno a
   * coordinar). Si ya hay un link vigente, lo devuelve tal cual: un "sí"
   * repetido no genera otro. El pago entra por el mismo webhook y conciliación
   * que los pedidos del catálogo.
   */
  async cobrar(
    userId: string,
    ventaId: string,
    opciones: {
      autor: Autor;
      medioPago?: MedioDePago;
      conversationId?: string;
      ahora?: Date;
      /** Lo que el asistente le pidió al aceptar (validado en el grafo). Sin esto, queda lo que ya tenía. */
      entrega?: Entrega | null;
      datosCliente?: DatoCliente[];
    },
  ): Promise<PedidoAMedida> {
    const ahora = opciones.ahora ?? new Date();
    const actual = await this.buscar(userId, ventaId);
    if (!actual || (opciones.conversationId && actual.conversationId !== opciones.conversationId)) {
      throw new PedidoRechazadoError('No encontré ese pedido.');
    }
    const estado = estadoVisible(actual, ahora);
    if (estado === 'pendiente_pago') return actual;
    const vigente = actual.presupuestos.find((presupuesto) => presupuesto.estado === 'enviado');
    if (!vigente || actual.totalCentavos === null) {
      throw new PedidoRechazadoError('Ese pedido todavía no tiene un presupuesto mandado: no hay nada que cobrar.');
    }
    if (!transicionPermitida('a_medida', estado, 'pendiente_pago')) {
      throw new PedidoRechazadoError('Ese pedido ya está cerrado: no se puede cobrar.');
    }

    const token = await this.cuentas.tokenDe(userId);
    const medio: MedioDePago = opciones.medioPago ?? (token ? 'mercadopago' : 'manual');
    if (medio === 'mercadopago' && !token) {
      throw new PedidoRechazadoError('El negocio no tiene Mercado Pago conectado: el cobro queda a coordinar.');
    }
    const solicitud = leerSolicitudDeVenta(actual.solicitud);
    const producto = solicitud?.productoId
      ? await this.prisma.producto.findFirst({ where: { id: solicitud.productoId, userId }, select: { codigo: true } })
      : null;

    const venta = await this.prisma.$transaction(async (tx) => {
      const bloqueada = await this.bloquear(tx, userId, ventaId);
      if (!bloqueada || bloqueada.estado !== actual.estado) {
        throw new PedidoRechazadoError('El pedido cambió mientras tanto: volvé a mirarlo.');
      }
      await tx.itemVenta.deleteMany({ where: { ventaId } });
      const item = itemDeCobro(solicitud, vigente);
      await tx.itemVenta.create({
        data: {
          ventaId,
          varianteId: item.varianteId,
          codigo: producto?.codigo ?? 'A-MEDIDA',
          nombreProducto: solicitud?.nombreProducto ?? 'Pedido a medida',
          nombreVariante: item.nombreVariante,
          precioUnitarioCentavos: item.precioUnitarioCentavos,
          cantidad: item.cantidad,
          subtotalCentavos: vigente.totalCentavos,
        },
      });
      await tx.eventoVenta.create({
        data: { ventaId, tipo: 'estado', de: bloqueada.estado, a: 'pendiente_pago', motivo: medio, autor: opciones.autor },
      });
      // Cobro sin link pedido por el asistente con el cobro manual configurado:
      // le manda los datos de pago y el chat queda para el negocio.
      const pausa =
        medio === 'manual' &&
        opciones.autor === 'asistente' &&
        bloqueada.conversationId !== null &&
        leerCondiciones(await tx.condicionesPago.findUnique({ where: { userId } })).cobroManual !== null;
      if (pausa) {
        await tx.eventoVenta.create({
          data: { ventaId, tipo: 'derivacion', de: bloqueada.atencion, a: 'humana', motivo: 'cobro_manual', autor: 'sistema' },
        });
      }
      return tx.venta.update({
        where: { id: ventaId },
        data: {
          estado: 'pendiente_pago',
          medioPago: medio,
          reservaVenceAt: vencimientoDeCobroAMedida(medio, ahora),
          linkPago: null,
          mpPreferenceId: null,
          ...(opciones.entrega ? { entrega: opciones.entrega } : {}),
          ...datosParaGuardar(opciones.datosCliente),
          ...(pausa ? pausaPorCobroManual(ahora) : {}),
        },
        include: { items: true },
      });
    });

    if (token && medio === 'mercadopago') {
      try {
        const preferencia = await this.ventas.crearPreferencia(token.accessToken, venta, venta.reservaVenceAt ?? ahora);
        await this.prisma.venta.update({
          where: { id: ventaId },
          data: { mpPreferenceId: preferencia.id, linkPago: preferencia.init_point },
        });
      } catch (error) {
        // Sin link, el pedido vuelve a "cotizado": el presupuesto sigue valiendo.
        await this.prisma.$transaction([
          this.prisma.venta.update({
            where: { id: ventaId },
            data: { estado: 'cotizado', medioPago: null, reservaVenceAt: null },
          }),
          this.prisma.eventoVenta.create({
            data: { ventaId, tipo: 'estado', de: 'pendiente_pago', a: 'cotizado', motivo: 'sin_link', autor: 'sistema' },
          }),
        ]);
        if (error instanceof MercadoPagoNoAutorizadoError) this.logger.warn(`Mercado Pago rechazó el token de ${userId}.`);
        this.logger.error(`No se pudo crear el link de pago del pedido a medida ${ventaId}: ${(error as Error).message}`);
        throw new PedidoRechazadoError(
          'No se pudo generar el link de pago. Decile al cliente que le escribimos por acá para coordinar el pago.',
        );
      }
    } else if (opciones.autor === 'asistente') {
      await this.avisar(
        userId,
        avisoPresupuestoAceptado({
          ...this.avisable(actual, solicitud),
          totalCentavos: vigente.totalCentavos,
          entrega: venta.entrega,
          atencion: venta.atencion,
        }),
      );
    }
    return this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: INCLUIR });
  }

  // --- Mensajes mientras atiende una persona ---------------------------------------------

  /**
   * Guarda un mensaje del chat mientras el asistente está callado: lo que
   * escribe el cliente y lo que le contesta el dueño desde su teléfono. Es
   * lo que ve el panel y lo que el asistente lee al retomar.
   */
  async guardarMensajeEnPausa(
    userId: string,
    remoteJid: string,
    texto: string,
    deQuien: 'cliente' | 'dueno',
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: { id: true },
    });
    if (!conversation) return;
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: deQuien === 'cliente' ? 'user' : 'assistant',
        content: deQuien === 'cliente' ? { content: texto, enAtencionHumana: true } : { content: texto, humano: true },
      },
    });
  }

  // --- Internos -------------------------------------------------------------------------

  /** El pedido con su fila bloqueada hasta el fin de la transacción (dos cambios a la vez se serializan). */
  private async bloquear(tx: Tx, userId: string, ventaId: string) {
    const [fila] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Venta" WHERE "id" = ${ventaId} AND "userId" = ${userId} FOR UPDATE
    `;
    if (!fila) return null;
    return tx.venta.findUniqueOrThrow({ where: { id: ventaId } });
  }

  /** Un cambio material: lo que estaba cotizado vuelve a "a cotizar" y el presupuesto deja de valer. */
  private async reabrirParaCotizar(tx: Tx, ventaId: string, estado: EstadoVenta, autor: Autor): Promise<void> {
    await tx.presupuesto.updateMany({ where: { ventaId, estado: { in: ['enviado', 'borrador'] } }, data: { estado: 'reemplazado' } });
    await tx.itemVenta.deleteMany({ where: { ventaId } });
    await tx.venta.update({
      where: { id: ventaId },
      data: {
        estado: 'a_cotizar',
        totalCentavos: null,
        medioPago: null,
        reservaVenceAt: null,
        linkPago: null,
        mpPreferenceId: null,
      },
    });
    if (estado !== 'a_cotizar') {
      await tx.eventoVenta.create({ data: { ventaId, tipo: 'estado', de: estado, a: 'a_cotizar', motivo: 'cambio_material', autor } });
    }
  }

  private buscarCualquiera(userId: string, ventaId: string): Promise<PedidoAMedida | null> {
    return this.prisma.venta.findFirst({ where: { id: ventaId, userId }, include: INCLUIR });
  }

  private avisable(venta: VentaConItems, solicitud: SolicitudDeVenta | null) {
    return {
      ventaId: venta.id,
      nombreCliente: venta.nombreCliente,
      telefonoCliente: venta.telefonoCliente,
      nombreProducto: solicitud?.nombreProducto ?? null,
      dePrueba: venta.dePrueba,
    };
  }

  /** Un aviso que falla no tira abajo el pedido. */
  private async avisar(userId: string, aviso: Aviso): Promise<void> {
    try {
      await this.notificaciones.avisar(userId, aviso);
    } catch (error) {
      this.logger.error(`No se pudo guardar el aviso ${aviso.tipo} para ${userId}: ${(error as Error).message}`);
    }
  }
}
