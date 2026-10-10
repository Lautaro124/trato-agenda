import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { ItemVenta, Venta } from '../generated/prisma/client.js';
import { leerDatosDeVenta, leerEntrega, type DatoCliente, type Entrega } from './datos-cliente.rules.js';
import { estadoVisible, ESTADOS_VENTA, type EstadoVenta } from './ventas.rules.js';

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
