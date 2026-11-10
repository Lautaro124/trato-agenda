import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mensajePropio } from '../agents/mensajes.rules.js';
import type { Env } from '../config/env.js';
import type { ItemVenta, Prisma, Venta } from '../generated/prisma/client.js';
import { leerPreguntas, validarRespuestas, type RespuestaDelModelo } from './preguntas-producto.rules.js';
import { avisoMercadoPagoDesconectado, avisoPedidoManual, avisoStock, avisoVentaPagada } from '../notificaciones/avisos.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { RegistroPerformanceService } from '../performance/registro.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MercadoPagoClient,
  MercadoPagoError,
  MercadoPagoNoAutorizadoError,
  type PagoMp,
  type Preferencia,
} from '../subscription/mercadopago.client.js';
import { describirStock, hayStock, monedaDe, stockBajo, type Moneda } from './catalogo.rules.js';
import {
  LARGO_MAX_ETIQUETA,
  LARGO_MAX_VALOR,
  leerEntrega,
  MAX_CAMPOS,
  type DatoCliente,
  type Entrega,
} from './datos-cliente.rules.js';
import {
  cuotasEnComun,
  descuentoEfectivo,
  leerCondiciones,
  leerCuotasProducto,
  problemaDeFormaDePago,
  recargoDeRenglon,
  valorDeCuota,
  type CondicionesPago,
  type CuotasProducto,
  type FormaDePago,
} from './condiciones-pago.rules.js';
import { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { tomarChat } from '../chats/atencion.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';
import { mejorDescuento, type DescuentoParaAplicar } from './descuentos.rules.js';
import { descuentosActivos } from './descuentos.types.js';
import { reservadasPorProducto } from './reservas.js';
import {
  agruparItems,
  detalleDeRenglones,
  MAX_PEDIDOS_PENDIENTES,
  mensajePagoAprobado,
  mensajeRecordatorioPago,
  MINUTOS_RECORDATORIO_PAGO,
  pagoSaldaVenta,
  problemaDeForma,
  pausaPorCobroManual,
  telefonoDeJid,
  vencimientoDeReserva,
  type ItemPedido,
  type MedioDePago,
} from './ventas.rules.js';

/**
 * La foto de los datos del cliente para `Venta.datosCliente`. Llegan ya
 * validados por el grafo; los topes se vuelven a aplicar acá porque es lo
 * último antes de la base. Sin datos, la columna queda en null.
 */
export function datosParaGuardar(datos: DatoCliente[] | undefined): { datosCliente?: Prisma.InputJsonValue } {
  const limpios = (datos ?? []).slice(0, MAX_CAMPOS).map((dato) => ({
    etiqueta: dato.etiqueta.slice(0, LARGO_MAX_ETIQUETA),
    valor: dato.valor.slice(0, LARGO_MAX_VALOR),
  }));
  return limpios.length > 0 ? { datosCliente: limpios } : {};
}

/** Un motivo de negocio para no crear el pedido, con el texto listo para el modelo o el panel. */
export class PedidoRechazadoError extends Error {}

export type VentaConItems = Venta & { items: ItemVenta[] };

/** El envío que va dentro de un pedido: la modalidad y lo que se cobra (0 si es gratis). */
export type EnvioDelPedido = { modalidad: string; centavos: number };

export type CrearPedidoInput = {
  userId: string;
  conversationId: string | null;
  remoteJid: string | null;
  nombreCliente: string;
  items: ItemPedido[];
  /** Lo que contestó el cliente a las preguntas de los productos; se valida contra las que tienen hoy. */
  respuestas?: RespuestaDelModelo[];
  medioPago: MedioDePago;
  /** Efectivo (con su descuento) o cuotas (con su recargo); sin ella, contado. */
  formaPago?: FormaDePago | null;
  /** Con `formaPago: "cuotas"`: un plan de las condiciones del comercio. */
  cuotas?: number | null;
  /** null si el comercio no hace envíos. */
  entrega?: Entrega | null;
  /**
   * Con entrega "envio" y el módulo de envíos activo: cuánto se cobra de envío
   * con el subtotal de los renglones ya reservados (para el envío gratis).
   * null = no va en el pedido: el link cobra sólo los productos.
   */
  cotizarEnvio?: ((subtotalCentavos: number, moneda: Moneda) => Promise<EnvioDelPedido | null>) | null;
  /** Lo que el cliente contestó, ya validado contra lo que pide el comercio. */
  datosCliente?: DatoCliente[];
  /** Pedido del banco de pruebas del Home: real, pero fuera del histórico. */
  dePrueba?: boolean;
  ahora?: Date;
};

/** Un producto que quedó en o por debajo de su mínimo al descontar una venta. */
export type ProductoConStockBajo = {
  productoId: string;
  codigo: string;
  nombreProducto: string;
  stock: number;
};

export type ResultadoPago = {
  venta: VentaConItems;
  /** false si ya estaba pagada: la notificación repetida no hace nada. */
  nueva: boolean;
  stockBajo: ProductoConStockBajo[];
};

type Tx = Prisma.TransactionClient;

type ProductoBloqueado = {
  id: string;
  codigo: string;
  nombre: string;
  precioCentavos: number;
  stock: number | null;
  disponible: boolean;
  plazoEntregaDias: number | null;
  activo: boolean;
  categoria: string | null;
  moneda: string;
  /** Las cuotas guardadas, sin validar (leerCuotasProducto). */
  cuotas: unknown;
  /** Las preguntas guardadas, sin validar (leerPreguntas). */
  preguntasPedido: unknown;
};

/** Lo que hace falta de un producto para ponerle precio a un renglón. */
type ProductoConPrecio = Pick<ProductoBloqueado, 'id' | 'codigo' | 'nombre' | 'categoria' | 'precioCentavos'>;

/** Cuánto sale cada forma de pago de un mismo pedido (ver_formas_de_pago). */
export type CotizacionFormasDePago = {
  moneda: Moneda;
  /** Con las promos vigentes: lo de siempre. */
  contadoCentavos: number;
  /** Con el mejor entre las promos y el descuento en efectivo; null si no hay. */
  efectivoCentavos: number | null;
  /** Las cuotas que tienen todos los productos, con lo que suma cada una. */
  planes: Array<{ cuotas: number; recargoCentavos: number; totalCentavos: number; cuotaCentavos: number }>;
  /** Sin planes, por qué: en dólares, ningún producto va en cuotas, o no comparten ninguna. */
  sinCuotas: 'dolares' | 'un_pago' | 'sin_comun' | null;
};

/**
 * Los renglones de un pedido con el precio que se cobra: el de lista con el
 * mejor descuento vigente de `descuentos`. Nunca los manda el modelo.
 */
function renglonesConPrecio(
  items: ItemPedido[],
  porId: Map<string, ProductoConPrecio>,
  descuentos: DescuentoParaAplicar[],
  moneda: Moneda,
  ahora: Date,
) {
  return items.map((item) => {
    const producto = porId.get(item.productoId) as ProductoConPrecio;
    const descuento = mejorDescuento(
      descuentos,
      { id: producto.id, categoria: producto.categoria, moneda },
      producto.precioCentavos,
      ahora,
    );
    const unitario = descuento?.precioFinalCentavos ?? producto.precioCentavos;
    return {
      productoId: producto.id,
      codigo: producto.codigo,
      nombreProducto: producto.nombre,
      precioUnitarioCentavos: unitario,
      cantidad: item.cantidad,
      subtotalCentavos: unitario * item.cantidad,
      precioListaCentavos: producto.precioCentavos,
      descuentoCentavos: descuento?.descuentoCentavos ?? 0,
      descuentoEtiqueta: descuento ? [descuento.etiqueta, descuento.nombre].filter(Boolean).join(' · ') : null,
    };
  });
}

/** Los descuentos de una forma de pago: en efectivo, además el del efectivo. */
function descuentosDe(descuentos: DescuentoParaAplicar[], condiciones: CondicionesPago, formaPago: FormaDePago | null) {
  const efectivo = formaPago === 'efectivo' ? descuentoEfectivo(condiciones) : null;
  return efectivo ? [...descuentos, efectivo] : descuentos;
}

function sumaDe(renglones: Array<{ subtotalCentavos: number }>): number {
  return renglones.reduce((suma, renglon) => suma + renglon.subtotalCentavos, 0);
}

/** Las cuotas de cada producto de un pedido, ya validadas contra su precio y su moneda. */
function cuotasPorProducto(
  productos: Array<{ id: string; cuotas: unknown; precioCentavos: number; moneda: string }>,
): Map<string, CuotasProducto | null> {
  return new Map(
    productos.map((producto) => [producto.id, leerCuotasProducto(producto.cuotas, producto.precioCentavos, producto.moneda)]),
  );
}

/** Lo que suma pagar el pedido en ese plan: el recargo de cada renglón. */
function recargoDelPedido(
  renglones: Array<{ productoId: string; cantidad: number; subtotalCentavos: number }>,
  cuotas: Map<string, CuotasProducto | null>,
  plan: number,
): number {
  return renglones.reduce((suma, renglon) => {
    const delProducto = cuotas.get(renglon.productoId);
    return suma + (delProducto ? recargoDeRenglon(delProducto, plan, renglon) : 0);
  }, 0);
}

/** Un pedido es de una sola moneda: el link de Mercado Pago y los totales no mezclan. */
const PEDIDO_CON_DOS_MONEDAS =
  'No se pueden mezclar productos en pesos y en dólares en un mismo pedido: hacé un pedido para cada moneda.';

/** Estados desde los que el dueño (o el cliente) puede cancelar un pedido. */
const ESTADOS_CANCELABLES = ['pendiente_pago', 'vencida'] as const;

/** Ventas de Mercado Pago que la conciliación sigue mirando después de vencida la reserva. */
const HORAS_CONCILIACION = 24;

/**
 * Pedidos y ventas del asistente de ventas. La reserva de stock es una regla
 * (ventas.rules.ts): una venta pendiente y sin vencer retiene sus unidades,
 * y la cuenta se hace sumando esas ventas, no con una tabla aparte.
 *
 * Crear un pedido bloquea (`FOR UPDATE`) los productos que pide, en orden de
 * id, dentro de una transacción: dos clientes que piden la última unidad al
 * mismo tiempo se serializan y el segundo ve la reserva del primero.
 */
@Injectable()
export class VentasService {
  private readonly logger = new Logger(VentasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoClient,
    private readonly cuentas: CuentaMercadoPagoService,
    private readonly config: ConfigService<Env, true>,
    private readonly notificaciones: NotificacionesService,
    private readonly registro: RegistroPerformanceService,
    private readonly suscripcion: SubscriptionService,
    private readonly horarioAtencion: HorarioAtencionService,
  ) {}

  /** Unidades retenidas por pedidos pendientes y sin vencer, por producto (ver reservas.ts). */
  reservadasPorProducto(
    productoIds: string[],
    tx: Tx | PrismaService = this.prisma,
    ahora: Date = new Date(),
  ): Promise<Map<string, number>> {
    return reservadasPorProducto(tx, productoIds, ahora);
  }

  /**
   * Crea el pedido con su reserva y, si es por Mercado Pago, el link de pago a
   * nombre del comercio. Cualquier motivo de negocio para no crearlo sale
   * como PedidoRechazadoError con un texto que el asistente puede usar.
   */
  async crearPedido(input: CrearPedidoInput): Promise<VentaConItems> {
    const ahora = input.ahora ?? new Date();
    const forma = problemaDeForma(input.items);
    if (forma) throw new PedidoRechazadoError(forma);
    const nombreCliente = input.nombreCliente.trim();
    if (!nombreCliente) throw new PedidoRechazadoError('Falta el nombre de la persona: preguntáselo antes.');

    // Mercado Pago cobra en pesos: un pedido en dólares se coordina a mano. La
    // moneda se vuelve a leer, bloqueada, dentro de la reserva.
    const moneda = await this.monedaDelPedido(input.userId, input.items.map((item) => item.productoId));
    // El efectivo se cobra en mano, nunca con el link.
    const medioPago: MedioDePago = moneda === 'USD' || input.formaPago === 'efectivo' ? 'manual' : input.medioPago;
    input = { ...input, medioPago };

    const token = input.medioPago === 'mercadopago' ? await this.cuentas.tokenDe(input.userId) : null;
    if (input.medioPago === 'mercadopago' && !token) {
      throw new PedidoRechazadoError(
        'El negocio todavía no conectó Mercado Pago, así que no hay link de pago. Ofrecé el pedido a coordinar con el negocio (medioPago "manual").',
      );
    }

    const items = agruparItems(input.items);
    const venta = await this.prisma.$transaction((tx) =>
      this.reservar(tx, input, items, nombreCliente, ahora, moneda),
    );

    if (token) {
      try {
        const preferencia = await this.crearPreferencia(
          token.accessToken,
          venta,
          venta.reservaVenceAt ?? vencimientoDeReserva(input.medioPago, ahora),
        );
        return await this.prisma.venta.update({
          where: { id: venta.id },
          data: { mpPreferenceId: preferencia.id, linkPago: preferencia.init_point },
          include: { items: true },
        });
      } catch (error) {
        // Sin link no hay forma de pagar: se libera la reserva en el acto.
        await this.prisma.venta.update({ where: { id: venta.id }, data: { estado: 'cancelada', canceladaAt: ahora } });
        if (error instanceof MercadoPagoNoAutorizadoError) await this.desconectarPorRevocacion(input.userId);
        this.logger.error(`No se pudo crear el link de pago de la venta ${venta.id}: ${(error as Error).message}`);
        throw new PedidoRechazadoError(
          'No se pudo generar el link de pago de Mercado Pago. Ofrecé el pedido a coordinar con el negocio (medioPago "manual").',
        );
      }
    }
    // Un pedido a cobrar a mano no avanza solo: el dueño tiene que enterarse.
    await this.avisar(input.userId, avisoPedidoManual(venta));
    return venta;
  }

  /**
   * El link de Checkout Pro de una venta, con sus renglones y a nombre del
   * comercio. Sin plan elegido es en un pago: las cuotas son las de cada
   * producto, con su recargo, y no las que la cuenta de Mercado Pago ofrezca.
   */
  crearPreferencia(accessToken: string, venta: VentaConItems, venceAt: Date): Promise<Preferencia> {
    const items = venta.items.map((item) => ({
      id: item.productoId ?? item.codigo,
      title: item.nombreProducto.slice(0, 250),
      quantity: item.cantidad,
      unit_price: item.precioUnitarioCentavos / 100,
      currency_id: venta.moneda,
    }));
    // El recargo del plan va como un renglón más, así los renglones suman el total.
    if (venta.recargoCentavos > 0) {
      items.push({
        id: 'recargo-cuotas',
        title: `Recargo por pago en ${venta.cuotas} cuotas`,
        quantity: 1,
        unit_price: venta.recargoCentavos / 100,
        currency_id: venta.moneda,
      });
    }
    // El envío también, así el cliente paga todo junto en el mismo link.
    if (venta.envioCentavos > 0) {
      items.push({
        id: 'envio',
        title: venta.envioModalidad === 'sucursal' ? 'Envío a sucursal del correo' : 'Envío a domicilio',
        quantity: 1,
        unit_price: venta.envioCentavos / 100,
        currency_id: venta.moneda,
      });
    }
    return this.mp.crearPreferencia(accessToken, {
      items,
      ...(venta.formaPago === 'cuotas' && venta.cuotas ? { cuotas: venta.cuotas } : { maxCuotas: 1 }),
      externalReference: venta.id,
      notificationUrl: `${this.config.get('API_PUBLIC_URL', { infer: true })}/ventas/webhook?venta=${venta.id}`,
      venceAt,
    });
  }

  /**
   * Cuánto sale un pedido en cada forma de pago del comercio, sin reservar
   * nada: lo que el asistente le dice al cliente antes de crear el pedido.
   * Los precios son los de crearPedido (misma cuenta), pero pueden cambiar
   * hasta que se reserve.
   */
  async cotizarFormasDePago(userId: string, pedido: ItemPedido[], ahora: Date = new Date()): Promise<CotizacionFormasDePago> {
    const forma = problemaDeForma(pedido);
    if (forma) throw new PedidoRechazadoError(forma);
    const items = agruparItems(pedido);
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: items.map((item) => item.productoId) }, userId, activo: true },
      select: { id: true, codigo: true, nombre: true, categoria: true, moneda: true, cuotas: true, precioCentavos: true },
    });
    const porId = new Map<string, ProductoConPrecio>(productos.map((producto) => [producto.id, producto]));
    if (items.some((item) => !porId.has(item.productoId))) {
      throw new PedidoRechazadoError('Alguno de los productos ya no está en el catálogo. Volvé a buscarlo.');
    }
    const monedas = new Set(productos.map((producto) => monedaDe(producto.moneda)));
    if (monedas.size > 1) throw new PedidoRechazadoError(PEDIDO_CON_DOS_MONEDAS);
    const moneda: Moneda = monedas.has('USD') ? 'USD' : 'ARS';

    const [descuentos, fila] = await Promise.all([
      descuentosActivos(this.prisma, userId, productos.map((producto) => producto.id)),
      this.prisma.condicionesPago.findUnique({ where: { userId } }),
    ]);
    const condiciones = leerCondiciones(fila);
    const renglones = renglonesConPrecio(items, porId, descuentos, moneda, ahora);
    const contado = sumaDe(renglones);
    const cuotas = cuotasPorProducto(productos);
    const enComun = moneda === 'ARS' ? cuotasEnComun([...cuotas.values()]) : [];
    const efectivo =
      condiciones.descuentoEfectivoPorcentaje === null
        ? null
        : sumaDe(renglonesConPrecio(items, porId, descuentosDe(descuentos, condiciones, 'efectivo'), moneda, ahora));
    return {
      moneda,
      contadoCentavos: contado,
      efectivoCentavos: efectivo,
      planes: enComun.map((plan) => {
        const recargo = recargoDelPedido(renglones, cuotas, plan);
        const total = contado + recargo;
        return { cuotas: plan, recargoCentavos: recargo, totalCentavos: total, cuotaCentavos: valorDeCuota(total, plan) };
      }),
      sinCuotas:
        enComun.length > 0
          ? null
          : moneda !== 'ARS'
            ? 'dolares'
            : [...cuotas.values()].every((delProducto) => delProducto === null)
              ? 'un_pago'
              : 'sin_comun',
    };
  }

  /** La moneda de los productos pedidos (sin bloquear); con dos distintas, rechaza. */
  private async monedaDelPedido(userId: string, productoIds: string[]): Promise<Moneda> {
    const productos = await this.prisma.producto.findMany({
      where: { userId, id: { in: productoIds } },
      select: { moneda: true },
    });
    const monedas = new Set(productos.map((producto) => monedaDe(producto.moneda)));
    if (monedas.size > 1) throw new PedidoRechazadoError(PEDIDO_CON_DOS_MONEDAS);
    return monedas.has('USD') ? 'USD' : 'ARS';
  }

  private async reservar(
    tx: Tx,
    input: CrearPedidoInput,
    items: ItemPedido[],
    nombreCliente: string,
    ahora: Date,
    moneda: Moneda,
  ): Promise<VentaConItems> {
    // Las condiciones se leen en la misma transacción que los precios: el total
    // es el de las que valían al reservar.
    const condiciones = leerCondiciones(await tx.condicionesPago.findUnique({ where: { userId: input.userId } }));
    const formaPago = input.formaPago ?? null;
    const cuotas = formaPago === 'cuotas' ? (input.cuotas ?? null) : null;

    // Por unidades de código, no por idioma: el orden sólo tiene que ser el mismo en todos los pedidos.
    const ids = items.map((item) => item.productoId).sort((a, b) => Number(a > b) - Number(a < b));
    // Orden fijo de bloqueo (por id): dos pedidos con los mismos productos no se traban entre sí.
    const productos = await tx.$queryRaw<ProductoBloqueado[]>`
      SELECT p."id", p."codigo", p."nombre", p."precioCentavos", p."stock", p."disponible", p."plazoEntregaDias", p."activo",
             p."categoria", p."moneda", p."cuotas", p."preguntasPedido"
      FROM "Producto" p
      WHERE p."id" = ANY(${ids}) AND p."userId" = ${input.userId} AND p."activo"
      ORDER BY p."id"
      FOR UPDATE
    `;
    const porId = new Map(productos.map((producto) => [producto.id, producto]));
    if (items.some((item) => !porId.has(item.productoId))) {
      throw new PedidoRechazadoError(
        'Alguno de los productos ya no está en el catálogo (o el id no es de una búsqueda). Volvé a buscarlo.',
      );
    }
    // Si el dueño cambió la moneda entre la lectura de arriba y este bloqueo, se
    // rechaza en vez de cobrar en la que no era.
    if (productos.some((producto) => monedaDe(producto.moneda) !== moneda)) {
      throw new PedidoRechazadoError(
        new Set(productos.map((producto) => monedaDe(producto.moneda))).size > 1
          ? PEDIDO_CON_DOS_MONEDAS
          : 'El precio de alguno de los productos acaba de cambiar. Volvé a buscarlo.',
      );
    }
    // Las cuotas salen de la misma lectura que los precios, no de la cotización.
    const cuotasDe = cuotasPorProducto(productos);
    // Las preguntas también salen de la lectura bloqueada: se responden las que el dueño tiene hoy.
    const respondidas = validarRespuestas(
      productos.map((producto) => ({ id: producto.id, nombre: producto.nombre, preguntas: leerPreguntas(producto.preguntasPedido) })),
      input.respuestas ?? [],
    );
    if ('error' in respondidas) throw new PedidoRechazadoError(respondidas.error);
    const problemaDePago = problemaDeFormaDePago(condiciones, formaPago, cuotas, moneda, [...cuotasDe.values()]);
    if (problemaDePago) throw new PedidoRechazadoError(problemaDePago);

    if (input.conversationId) {
      const pendientes = await tx.venta.count({
        where: { conversationId: input.conversationId, estado: 'pendiente_pago', reservaVenceAt: { gt: ahora } },
      });
      if (pendientes >= MAX_PEDIDOS_PENDIENTES) {
        throw new PedidoRechazadoError(
          `Este cliente ya tiene ${pendientes} pedidos sin pagar. Que pague o cancele alguno antes de hacer otro.`,
        );
      }
    }

    const reservadas = await this.reservadasPorProducto(ids, tx, ahora);
    for (const item of items) {
      const producto = porId.get(item.productoId) as ProductoBloqueado;
      if (!hayStock(producto, item.cantidad, reservadas.get(producto.id) ?? 0)) {
        throw new PedidoRechazadoError(
          `No hay stock suficiente de ${JSON.stringify(producto.nombre)} para ` +
            `${item.cantidad === 1 ? '1 unidad' : `${item.cantidad} unidades`}: ` +
            `${describirStock(producto, reservadas.get(producto.id) ?? 0)}.`,
        );
      }
    }

    // El precio sale siempre de acá, con el descuento que esté vigente al
    // reservar: el modelo sólo manda productos y cantidades. Leídos en la misma
    // transacción para que el total sea el que se le cobra.
    const descuentos = await descuentosActivos(
      tx,
      input.userId,
      productos.map((producto) => producto.id),
    );
    const renglones = renglonesConPrecio(items, porId, descuentosDe(descuentos, condiciones, formaPago), moneda, ahora).map(
      (renglon) => {
        const respuestas = respondidas.porProducto.get(renglon.productoId) ?? [];
        return { ...renglon, ...(respuestas.length > 0 && { respuestas }) };
      },
    );
    const subtotal = sumaDe(renglones);
    // El recargo de cuotas es sólo sobre los productos: el envío se cobra a su tarifa.
    const recargo = cuotas !== null ? recargoDelPedido(renglones, cuotasDe, cuotas) : 0;
    const entrega = leerEntrega(input.entrega);
    const envio = entrega === 'envio' && input.cotizarEnvio ? await input.cotizarEnvio(subtotal, moneda) : null;

    const pausa = input.medioPago === 'manual' && condiciones.cobroManual !== null && input.conversationId !== null;
    const venta = await tx.venta.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        nombreCliente,
        telefonoCliente: input.remoteJid ? telefonoDeJid(input.remoteJid) : null,
        estado: 'pendiente_pago',
        medioPago: input.medioPago,
        formaPago,
        cuotas,
        recargoCentavos: recargo,
        envioCentavos: envio?.centavos ?? 0,
        envioModalidad: envio?.modalidad ?? null,
        totalCentavos: subtotal + recargo + (envio?.centavos ?? 0),
        moneda,
        reservaVenceAt: vencimientoDeReserva(input.medioPago, ahora),
        dePrueba: input.dePrueba ?? false,
        entrega,
        ...datosParaGuardar(input.datosCliente),
        items: { create: renglones },
        // Con el cobro manual configurado, el asistente manda los datos de pago y
        // el chat queda para el negocio hasta que el dueño se lo devuelva (LAU-81).
        ...(pausa
          ? {
              ...pausaPorCobroManual(ahora),
              eventos: {
                create: { tipo: 'derivacion', de: 'asistente', a: 'humana', motivo: 'cobro_manual', autor: 'sistema' },
              },
            }
          : {}),
      },
      include: { items: true },
    });
    if (input.conversationId) {
      // Igual que con los turnos: el nombre se pregunta una vez por conversación.
      await tx.conversation.update({ where: { id: input.conversationId }, data: { nombreCliente } });
      // Cobro manual: el chat queda en manos del negocio (LAU-81).
      if (pausa) await tomarChat(tx, input.userId, input.conversationId, ahora);
    }
    return venta;
  }

  /** Una venta del dueño, o null si no existe o es de otro. */
  buscarDelDueno(userId: string, ventaId: string): Promise<VentaConItems | null> {
    return this.prisma.venta.findFirst({ where: { id: ventaId, userId }, include: { items: true } });
  }

  /** Los pedidos más recientes de una conversación, para `consultar_pedido`. */
  pedidosDeConversacion(conversationId: string, limite = 3): Promise<VentaConItems[]> {
    return this.prisma.venta.findMany({
      where: { conversationId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  /** Cancela el pedido pendiente más reciente de la conversación (el cliente se arrepintió). */
  async cancelarUltimoPendiente(conversationId: string, ahora: Date = new Date()): Promise<VentaConItems | null> {
    const venta = await this.prisma.venta.findFirst({
      where: { conversationId, estado: 'pendiente_pago' },
      orderBy: { createdAt: 'desc' },
    });
    if (!venta) return null;
    return this.cancelar(venta.userId, venta.id, ahora);
  }

  /**
   * Cancela un pedido sin pagar del dueño. null si no existe, no es suyo o ya
   * no se puede cancelar.
   */
  async cancelar(userId: string, ventaId: string, ahora: Date = new Date()): Promise<VentaConItems | null> {
    const { count } = await this.prisma.venta.updateMany({
      where: { id: ventaId, userId, estado: { in: [...ESTADOS_CANCELABLES] } },
      data: { estado: 'cancelada', canceladaAt: ahora },
    });
    if (count === 0) return null;
    return this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId }, include: { items: true } });
  }

  /**
   * Pasa una venta a pagada y descuenta el stock. Idempotente: una venta ya
   * pagada no se toca (el webhook de Mercado Pago llega repetido). Si la
   * reserva había vencido y otro compró lo último, la venta queda pagada igual
   * —la plata ya entró— y marcada `sinStockAlPagar` para que el dueño resuelva.
   */
  async marcarPagada(
    ventaId: string,
    opciones: { mpPaymentId?: string; ahora?: Date } = {},
  ): Promise<ResultadoPago | null> {
    const ahora = opciones.ahora ?? new Date();
    const resultado = await this.prisma.$transaction(async (tx) => {
      const [bloqueada] = await tx.$queryRaw<Array<{ id: string; estado: string }>>`
        SELECT "id", "estado" FROM "Venta" WHERE "id" = ${ventaId} FOR UPDATE
      `;
      if (!bloqueada) return null;
      if (bloqueada.estado === 'pagada') {
        const venta = await tx.venta.findUniqueOrThrow({ where: { id: ventaId }, include: { items: true } });
        return { venta, nueva: false, stockBajo: [] };
      }

      const items = await tx.itemVenta.findMany({ where: { ventaId } });
      let sinStock = false;
      const conStockBajo: ProductoConStockBajo[] = [];
      for (const item of items) {
        if (!item.productoId) continue;
        const [descontada] = await tx.$queryRaw<Array<{ stock: number; stockMinimo: number | null }>>`
          UPDATE "Producto" SET "stock" = "stock" - ${item.cantidad}
          WHERE "id" = ${item.productoId} AND "stock" IS NOT NULL AND "stock" >= ${item.cantidad}
          RETURNING "stock", "stockMinimo"
        `;
        let resultado = descontada;
        if (!resultado) {
          // O no controla cantidad (stock null, no hay nada que descontar) o no alcanzó.
          const [faltante] = await tx.$queryRaw<Array<{ stock: number; stockMinimo: number | null }>>`
            UPDATE "Producto" SET "stock" = 0
            WHERE "id" = ${item.productoId} AND "stock" IS NOT NULL
            RETURNING "stock", "stockMinimo"
          `;
          if (faltante) sinStock = true;
          resultado = faltante;
        }
        if (resultado && stockBajo({ stock: resultado.stock, stockMinimo: resultado.stockMinimo ?? 0 })) {
          conStockBajo.push({
            productoId: item.productoId,
            codigo: item.codigo,
            nombreProducto: item.nombreProducto,
            stock: resultado.stock,
          });
        }
      }

      const venta = await tx.venta.update({
        where: { id: ventaId },
        data: {
          estado: 'pagada',
          pagadaAt: ahora,
          sinStockAlPagar: sinStock,
          ...(opciones.mpPaymentId ? { mpPaymentId: opciones.mpPaymentId } : {}),
        },
        include: { items: true },
      });
      return { venta, nueva: true, stockBajo: conStockBajo };
    });
    // Fuera de la transacción: la métrica nunca frena el pago (y es de mejor esfuerzo).
    if (resultado?.nueva) await this.registro.avanzarPorVenta(resultado.venta, 'pagado');
    return resultado;
  }

  /**
   * Una notificación de Mercado Pago sobre un pago. No se confía en nada de lo
   * que trae: se vuelve a pedir el pago con el token del comercio dueño de la
   * venta, y sólo si ese pago la salda (aprobado, misma venta, mismo monto y
   * moneda) se marca pagada.
   */
  async procesarPago(paymentId: string, ventaIdSugerida: string | undefined): Promise<ResultadoPago | null> {
    if (!ventaIdSugerida) return null;
    const venta = await this.prisma.venta.findUnique({ where: { id: ventaIdSugerida } });
    if (!venta || venta.medioPago !== 'mercadopago' || venta.estado === 'pagada') return null;

    const token = await this.cuentas.tokenDe(venta.userId);
    if (!token) return null;
    const pago = await this.mp.obtenerPago(token.accessToken, paymentId);
    return this.aplicarPago(venta, pago);
  }

  /** El dueño cobró por fuera. Sólo pedidos propios sin pagar; avisa el stock, no la venta (la marcó él). */
  async marcarPagadaPorElDueno(userId: string, ventaId: string): Promise<VentaConItems | null> {
    const venta = await this.buscarDelDueno(userId, ventaId);
    if (!venta || !['pendiente_pago', 'vencida'].includes(venta.estado)) return null;
    const resultado = await this.marcarPagada(ventaId);
    if (!resultado) return null;
    await this.avisarStock(userId, resultado);
    if (resultado.nueva) await this.avisarPagoAlCliente(resultado.venta);
    return resultado.venta;
  }

  private async aplicarPago(venta: Venta, pago: PagoMp): Promise<ResultadoPago | null> {
    if (!pagoSaldaVenta(pago, venta)) return null;
    const resultado = await this.marcarPagada(venta.id, { mpPaymentId: String(pago.id) });
    if (resultado?.nueva) {
      await this.avisar(venta.userId, avisoVentaPagada(resultado.venta));
      await this.avisarStock(venta.userId, resultado);
      await this.avisarPagoAlCliente(resultado.venta);
    }
    return resultado;
  }

  /**
   * Le dice al cliente, en el chat de donde salió el pedido, que su pago se
   * aprobó. Sólo una vez (lo llaman cuando la venta pasa a pagada) y nunca
   * para un pedido del banco de pruebas, que no tiene un chat de WhatsApp.
   */
  private async avisarPagoAlCliente(venta: Venta): Promise<void> {
    if (venta.dePrueba || !venta.conversationId) return;
    try {
      const [conversation, agent] = await Promise.all([
        this.prisma.conversation.findUnique({ where: { id: venta.conversationId }, select: { remoteJid: true } }),
        this.prisma.agent.findUnique({ where: { userId: venta.userId }, select: { nombreTitular: true, mensajes: true } }),
      ]);
      if (!conversation) return;
      const plantilla = agent ? mensajePropio(agent, 'pagoAprobado') : null;
      const propio = plantilla
        ? {
            plantilla,
            detalle: /\{detalle\}/.test(plantilla)
              ? detalleDeRenglones(
                  await this.prisma.itemVenta.findMany({ where: { ventaId: venta.id }, orderBy: { id: 'asc' } }),
                  venta.moneda,
                )
              : '',
          }
        : null;
      const enviado = await this.notificaciones.avisarAlCliente(
        venta.userId,
        conversation.remoteJid,
        mensajePagoAprobado(venta, agent?.nombreTitular ?? null, propio),
      );
      if (!enviado) this.logger.warn(`No se le pudo avisar al cliente el pago de la venta ${venta.id}.`);
    } catch (error) {
      this.logger.error(`No se pudo avisar al cliente el pago de la venta ${venta.id}: ${(error as Error).message}`);
    }
  }

  private async avisarStock(userId: string, resultado: ResultadoPago): Promise<void> {
    for (const producto of resultado.stockBajo) await this.avisar(userId, avisoStock(producto));
  }

  /** Mercado Pago dejó de aceptar el token del comercio: se desconecta y se le avisa. */
  private async desconectarPorRevocacion(userId: string): Promise<void> {
    await this.cuentas.desconectar(userId);
    await this.avisar(userId, avisoMercadoPagoDesconectado());
  }

  /** Un aviso que falla no tira abajo la venta: queda logueado y sigue. */
  private async avisar(userId: string, aviso: Parameters<NotificacionesService['avisar']>[1]): Promise<void> {
    try {
      await this.notificaciones.avisar(userId, aviso);
    } catch (error) {
      this.logger.error(`No se pudo guardar el aviso ${aviso.tipo} para ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Red de seguridad del webhook: busca en Mercado Pago los pagos de las ventas
   * que siguen sin pagar (hasta un día después de vencida la reserva). Así un
   * webhook perdido o mal firmado no deja una venta cobrada sin registrar.
   */
  async conciliar(ahora: Date = new Date()): Promise<ResultadoPago[]> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        medioPago: 'mercadopago',
        estado: { in: ['pendiente_pago', 'vencida'] },
        reservaVenceAt: { gt: new Date(ahora.getTime() - HORAS_CONCILIACION * 60 * 60 * 1000) },
        mpPreferenceId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    const cobradas: ResultadoPago[] = [];
    for (const venta of ventas) {
      try {
        const token = await this.cuentas.tokenDe(venta.userId);
        if (!token) continue;
        const pagos = await this.mp.buscarPagos(token.accessToken, venta.id);
        const saldo = pagos.find((pago) => pagoSaldaVenta(pago, venta));
        if (!saldo) continue;
        const resultado = await this.aplicarPago(venta, saldo);
        if (resultado?.nueva) cobradas.push(resultado);
      } catch (error) {
        if (error instanceof MercadoPagoNoAutorizadoError) {
          await this.desconectarPorRevocacion(venta.userId);
        } else if (!(error instanceof MercadoPagoError)) {
          throw error;
        }
        this.logger.warn(`No se pudo conciliar la venta ${venta.id}: ${(error as Error).message}`);
      }
    }
    return cobradas;
  }

  /**
   * Le recuerda al cliente, una sola vez, que la reserva de su link de Mercado
   * Pago está por vencer y todavía no pagó. Nunca en pedidos de prueba, con el
   * chat en atención humana, con el asistente suspendido ni fuera del horario
   * de atención (salvo conversación en curso, LAU-29). Devuelve cuántos
   * recordatorios salieron.
   */
  async recordarPagos(ahora: Date = new Date()): Promise<number> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        estado: 'pendiente_pago',
        medioPago: 'mercadopago',
        dePrueba: false,
        conversationId: { not: null },
        recordatorioPagoAt: null,
        reservaVenceAt: { gt: ahora, lte: new Date(ahora.getTime() + MINUTOS_RECORDATORIO_PAGO * 60 * 1000) },
      },
      orderBy: { reservaVenceAt: 'asc' },
      take: 100,
    });

    let enviados = 0;
    for (const venta of ventas) {
      try {
        if (await this.recordarPago(venta, ahora)) enviados++;
      } catch (error) {
        this.logger.error(`No se pudo recordar el pago de la venta ${venta.id}: ${(error as Error).message}`);
      }
    }
    return enviados;
  }

  private async recordarPago(venta: Venta, ahora: Date): Promise<boolean> {
    if (!venta.conversationId || !venta.reservaVenceAt) return false;
    const [posteriores, humana] = await Promise.all([
      // Si después pidió otra cosa en el mismo chat, recordarle el pedido viejo confunde.
      this.prisma.venta.count({ where: { conversationId: venta.conversationId, createdAt: { gt: venta.createdAt } } }),
      // Mientras lo atiende una persona, el asistente no escribe (LAU-81).
      this.prisma.conversation.count({ where: { id: venta.conversationId, atencion: 'humana' } }),
    ]);
    if (posteriores > 0 || humana > 0) return false;
    if (!(await this.suscripcion.asistenteActivo(venta.userId))) return false;
    if (!(await this.horarioAtencion.puedeEscribir(venta.userId, venta.conversationId, ahora))) return false;

    // Se marca antes de mandarlo: con dos barridos a la vez, o si el envío falla, sale una vez como mucho.
    const { count } = await this.prisma.venta.updateMany({
      where: { id: venta.id, estado: 'pendiente_pago', recordatorioPagoAt: null },
      data: { recordatorioPagoAt: ahora },
    });
    if (count === 0) return false;

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: venta.conversationId, userId: venta.userId },
      select: { remoteJid: true },
    });
    if (!conversation) return false;
    const enviado = await this.notificaciones.avisarAlCliente(
      venta.userId,
      conversation.remoteJid,
      mensajeRecordatorioPago({ ...venta, reservaVenceAt: venta.reservaVenceAt }),
    );
    if (!enviado) this.logger.warn(`No se le pudo recordar al cliente el pago de la venta ${venta.id}.`);
    return enviado;
  }

  /** Marca como vencidas las pendientes pasadas de hora. Es sólo para mostrar: la reserva ya no cuenta igual. */
  async vencerReservas(ahora: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.venta.updateMany({
      where: { estado: 'pendiente_pago', reservaVenceAt: { lte: ahora } },
      data: { estado: 'vencida' },
    });
    return count;
  }
}
