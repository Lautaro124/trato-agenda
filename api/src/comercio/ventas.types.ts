import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { EventoVenta, ItemVenta, Message, Venta } from '../generated/prisma/client.js';
import { leerRespuestas, type RespuestaGuardada } from './preguntas-producto.rules.js';
import { MONEDAS, type Moneda } from './catalogo.rules.js';
import { leerDatosDeVenta, leerEntrega, type DatoCliente, type Entrega } from './datos-cliente.rules.js';
import {
  ATENCIONES,
  estadoVisible,
  ESTADOS_VENTA,
  LARGO_MAX_NOTA,
  type Atencion,
  type EstadoVenta,
} from './ventas.rules.js';

/** Lo que ve el dueño de una venta. Nunca los ids de Mercado Pago de la preferencia. */
export type VentaPublica = Pick<
  Venta,
  | 'id'
  | 'medioPago'
  | 'formaPago'
  | 'cuotas'
  | 'recargoCentavos'
  | 'nombreCliente'
  | 'telefonoCliente'
  | 'totalCentavos'
  | 'moneda'
  | 'reservaVenceAt'
  | 'linkPago'
  | 'pagadaAt'
  | 'canceladaAt'
  | 'sinStockAlPagar'
  | 'dePrueba'
  | 'createdAt'
> & {
  estado: EstadoVenta;
  /** "humana" mientras lo atiende una persona y el asistente no contesta en ese chat. */
  atencion: Atencion;
  derivadaAt: Date | null;
  motivoDerivacion: string | null;
  detalleDerivacion: string | null;
  devueltaAt: Date | null;
  /** Si el pago vino por Mercado Pago, el número de operación (para buscarlo en su cuenta). */
  mpPaymentId: string | null;
  /** null si el comercio no hace envíos. */
  entrega: Entrega | null;
  /** Lo que el cliente contestó (envío, DNI, campos propios). Vacío si no se pidió nada. */
  datosCliente: DatoCliente[];
  items: Array<
    Pick<
      ItemVenta,
      | 'codigo'
      | 'nombreProducto'
      | 'cantidad'
      | 'precioUnitarioCentavos'
      | 'subtotalCentavos'
      | 'precioListaCentavos'
      | 'descuentoCentavos'
      | 'descuentoEtiqueta'
    > & {
      /** Lo que contestó el cliente a las preguntas del producto; vacío si no tenía. */
      respuestas: RespuestaGuardada[];
    }
  >;
};

export function aVentaPublica(venta: Venta & { items: ItemVenta[] }, ahora: Date = new Date()): VentaPublica {
  return {
    id: venta.id,
    estado: estadoVisible(venta, ahora),
    atencion: venta.atencion === 'humana' ? 'humana' : 'asistente',
    derivadaAt: venta.derivadaAt,
    motivoDerivacion: venta.motivoDerivacion,
    detalleDerivacion: venta.detalleDerivacion,
    devueltaAt: venta.devueltaAt,
    medioPago: venta.medioPago,
    formaPago: venta.formaPago,
    cuotas: venta.cuotas,
    recargoCentavos: venta.recargoCentavos,
    nombreCliente: venta.nombreCliente,
    telefonoCliente: venta.telefonoCliente,
    totalCentavos: venta.totalCentavos,
    moneda: venta.moneda,
    reservaVenceAt: venta.reservaVenceAt,
    linkPago: venta.linkPago,
    pagadaAt: venta.pagadaAt,
    canceladaAt: venta.canceladaAt,
    sinStockAlPagar: venta.sinStockAlPagar,
    dePrueba: venta.dePrueba,
    createdAt: venta.createdAt,
    mpPaymentId: venta.mpPaymentId,
    entrega: leerEntrega(venta.entrega),
    datosCliente: leerDatosDeVenta(venta.datosCliente),
    items: venta.items.map((item) => ({
      codigo: item.codigo,
      nombreProducto: item.nombreProducto,
      cantidad: item.cantidad,
      precioUnitarioCentavos: item.precioUnitarioCentavos,
      subtotalCentavos: item.subtotalCentavos,
      precioListaCentavos: item.precioListaCentavos,
      descuentoCentavos: item.descuentoCentavos,
      descuentoEtiqueta: item.descuentoEtiqueta,
      respuestas: leerRespuestas(item.respuestas),
    })),
  };
}

export type MensajePublico = {
  /** "cliente" | "asistente" | "dueno" (lo que contestó el dueño desde su teléfono). */
  de: 'cliente' | 'asistente' | 'dueno';
  texto: string;
  createdAt: Date;
};

/** Los mensajes de texto de la conversación, sin herramientas ni contenido que no sea texto. */
export function aMensajesPublicos(mensajes: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>): MensajePublico[] {
  return mensajes.flatMap((mensaje): MensajePublico[] => {
    const contenido = mensaje.content as { content?: unknown; humano?: unknown } | null;
    const texto = typeof contenido?.content === 'string' ? contenido.content.trim() : '';
    if (!texto) return [];
    const de = mensaje.role === 'user' ? 'cliente' : contenido?.humano === true ? 'dueno' : 'asistente';
    return [{ de, texto: texto.slice(0, 2000), createdAt: mensaje.createdAt }];
  });
}

/** El detalle de un pedido: además de lo del listado, historial y conversación. */
export type DetalleVentaPublica = VentaPublica & {
  notaDevolucion: string | null;
  eventos: Array<Pick<EventoVenta, 'tipo' | 'de' | 'a' | 'motivo' | 'autor' | 'createdAt'>>;
  mensajes: MensajePublico[];
};

export function aDetalleVentaPublica(
  venta: Venta & {
    items: ItemVenta[];
    eventos: EventoVenta[];
    mensajes: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>;
  },
  ahora: Date = new Date(),
): DetalleVentaPublica {
  return {
    ...aVentaPublica(venta, ahora),
    notaDevolucion: venta.notaDevolucion,
    eventos: venta.eventos.map(({ tipo, de, a, motivo, autor, createdAt }) => ({ tipo, de, a, motivo, autor, createdAt })),
    mensajes: aMensajesPublicos(venta.mensajes),
  };
}

/** "Devolver al asistente", con una nota opcional. */
export class DevolverDto {
  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_NOTA)
  nota?: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros del histórico (`GET /ventas`, `/ventas/resumen`, `/ventas/export.csv`). */
export class FiltrosVentasQuery {
  @IsOptional()
  @Matches(DIA, { message: 'desde tiene que ser AAAA-MM-DD.' })
  desde?: string;

  @IsOptional()
  @Matches(DIA, { message: 'hasta tiene que ser AAAA-MM-DD.' })
  hasta?: string;

  @IsOptional()
  @IsIn(ESTADOS_VENTA)
  estado?: EstadoVenta;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Sólo los pedidos que atiende una persona. */
  @IsOptional()
  @IsIn(ATENCIONES)
  atencion?: Atencion;

  /** "true" en el query string. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  incluirPrueba?: boolean;

  /** La moneda de los totales y los gráficos (el listado trae todas). Por defecto, pesos. */
  @IsOptional()
  @IsIn(MONEDAS)
  moneda?: Moneda;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  pagina?: number;
}
