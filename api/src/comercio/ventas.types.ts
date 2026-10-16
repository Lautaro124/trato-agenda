import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { EventoVenta, ItemVenta, Message, Presupuesto, Venta } from '../generated/prisma/client.js';
import { leerDatosDeVenta, leerEntrega, type DatoCliente, type Entrega } from './datos-cliente.rules.js';
import {
  ATENCIONES,
  LARGO_MAX_NOTA,
  leerSolicitudDeVenta,
  leerTipoVenta,
  type Atencion,
  type SolicitudDeVenta,
  type TipoVenta,
} from './pedido-a-medida.rules.js';
import {
  CANTIDAD_MAX,
  LARGO_MAX_CONCEPTO,
  LARGO_MAX_NOTA_PRESUPUESTO,
  LARGO_MAX_UNIDAD,
  leerRenglones,
  MAX_RENGLONES_PRESUPUESTO,
  TIPOS_RENGLON,
  TOTAL_MAX_CENTAVOS,
  type RenglonPresupuesto,
} from './presupuesto.rules.js';
import { estadoVisible, ESTADOS_VENTA, MEDIOS_DE_PAGO, type EstadoVenta, type MedioDePago } from './ventas.rules.js';

/** Lo que ve el dueño de una venta. Nunca los ids de Mercado Pago de la preferencia. */
export type VentaPublica = Pick<
  Venta,
  | 'id'
  | 'medioPago'
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
  /** "stock" (del catálogo) | "a_medida" (se cotiza). */
  tipo: TipoVenta;
  /** "humana" mientras lo atiende una persona y el asistente no contesta en ese chat. */
  atencion: Atencion;
  derivadaAt: Date | null;
  motivoDerivacion: string | null;
  detalleDerivacion: string | null;
  devueltaAt: Date | null;
  /** Sólo a medida: lo que pidió el cliente. */
  solicitud: SolicitudDeVenta | null;
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
      | 'nombreVariante'
      | 'cantidad'
      | 'precioUnitarioCentavos'
      | 'subtotalCentavos'
      | 'precioListaCentavos'
      | 'descuentoCentavos'
      | 'descuentoEtiqueta'
    >
  >;
};

export function aVentaPublica(venta: Venta & { items: ItemVenta[] }, ahora: Date = new Date()): VentaPublica {
  return {
    id: venta.id,
    estado: estadoVisible(venta, ahora),
    tipo: leerTipoVenta(venta.tipo),
    atencion: venta.atencion === 'humana' ? 'humana' : 'asistente',
    derivadaAt: venta.derivadaAt,
    motivoDerivacion: venta.motivoDerivacion,
    detalleDerivacion: venta.detalleDerivacion,
    devueltaAt: venta.devueltaAt,
    solicitud: venta.tipo === 'a_medida' ? leerSolicitudDeVenta(venta.solicitud) : null,
    medioPago: venta.medioPago,
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
      nombreVariante: item.nombreVariante,
      cantidad: item.cantidad,
      precioUnitarioCentavos: item.precioUnitarioCentavos,
      subtotalCentavos: item.subtotalCentavos,
      precioListaCentavos: item.precioListaCentavos,
      descuentoCentavos: item.descuentoCentavos,
      descuentoEtiqueta: item.descuentoEtiqueta,
    })),
  };
}

/** Un presupuesto como lo ve el dueño (los renglones con su costo, aunque el cliente vea sólo el total). */
export type PresupuestoPublico = Pick<
  Presupuesto,
  | 'id'
  | 'version'
  | 'origen'
  | 'estado'
  | 'totalCentavos'
  | 'moneda'
  | 'estimativo'
  | 'detalleAlCliente'
  | 'nota'
  | 'enviadoAt'
  | 'createdAt'
> & { renglones: RenglonPresupuesto[] };

export function aPresupuestoPublico(presupuesto: Presupuesto): PresupuestoPublico {
  return {
    id: presupuesto.id,
    version: presupuesto.version,
    origen: presupuesto.origen,
    estado: presupuesto.estado,
    totalCentavos: presupuesto.totalCentavos,
    moneda: presupuesto.moneda,
    estimativo: presupuesto.estimativo,
    detalleAlCliente: presupuesto.detalleAlCliente,
    nota: presupuesto.nota,
    enviadoAt: presupuesto.enviadoAt,
    createdAt: presupuesto.createdAt,
    renglones: leerRenglones(presupuesto.renglones),
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

/** El detalle de un pedido: además de lo del listado, presupuestos, historial y conversación. */
export type DetalleVentaPublica = VentaPublica & {
  notaDevolucion: string | null;
  presupuestos: PresupuestoPublico[];
  eventos: Array<Pick<EventoVenta, 'tipo' | 'de' | 'a' | 'motivo' | 'autor' | 'createdAt'>>;
  mensajes: MensajePublico[];
};

export function aDetalleVentaPublica(
  venta: Venta & {
    items: ItemVenta[];
    presupuestos: Presupuesto[];
    eventos: EventoVenta[];
    mensajes: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>;
  },
  ahora: Date = new Date(),
): DetalleVentaPublica {
  return {
    ...aVentaPublica(venta, ahora),
    notaDevolucion: venta.notaDevolucion,
    presupuestos: venta.presupuestos.map(aPresupuestoPublico),
    eventos: venta.eventos.map(({ tipo, de, a, motivo, autor, createdAt }) => ({ tipo, de, a, motivo, autor, createdAt })),
    mensajes: aMensajesPublicos(venta.mensajes),
  };
}

export class RenglonPresupuestoDto {
  @IsString()
  @MaxLength(LARGO_MAX_CONCEPTO)
  concepto!: string;

  @IsOptional()
  @IsIn(TIPOS_RENGLON)
  tipo?: (typeof TIPOS_RENGLON)[number];

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(CANTIDAD_MAX)
  cantidad!: number;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_UNIDAD)
  unidad?: string;

  @IsInt()
  @Min(0)
  @Max(TOTAL_MAX_CENTAVOS)
  precioUnitarioCentavos!: number;
}

/** Un presupuesto armado por el dueño en el panel (`POST /ventas/:id/presupuestos`). */
export class PresupuestoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RENGLONES_PRESUPUESTO)
  @ValidateNested({ each: true })
  @Type(() => RenglonPresupuestoDto)
  renglones!: RenglonPresupuestoDto[];

  @IsBoolean()
  estimativo!: boolean;

  @IsBoolean()
  detalleAlCliente!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_NOTA_PRESUPUESTO)
  nota?: string;

  /** true: se manda al cliente en el mismo paso (si no, queda como borrador). */
  @IsOptional()
  @IsBoolean()
  enviar?: boolean;
}

/** "Atender yo" (`humana: true`) o "Devolver al asistente" con una nota opcional. */
export class AtencionDto {
  @IsBoolean()
  humana!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_NOTA)
  nota?: string;
}

export class CobrarDto {
  @IsOptional()
  @IsIn(MEDIOS_DE_PAGO)
  medioPago?: MedioDePago;
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  pagina?: number;
}
