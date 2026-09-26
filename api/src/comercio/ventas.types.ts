import { IsIn, IsOptional } from 'class-validator';
import type { ItemVenta, Venta } from '../generated/prisma/client.js';
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
  | 'createdAt'
> & {
  estado: EstadoVenta;
  /** Si el pago vino por Mercado Pago, el número de operación (para buscarlo en su cuenta). */
  mpPaymentId: string | null;
  items: Array<
    Pick<ItemVenta, 'codigo' | 'nombreProducto' | 'nombreVariante' | 'cantidad' | 'precioUnitarioCentavos' | 'subtotalCentavos'>
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
    createdAt: venta.createdAt,
    mpPaymentId: venta.mpPaymentId,
    items: venta.items.map((item) => ({
      codigo: item.codigo,
      nombreProducto: item.nombreProducto,
      nombreVariante: item.nombreVariante,
      cantidad: item.cantidad,
      precioUnitarioCentavos: item.precioUnitarioCentavos,
      subtotalCentavos: item.subtotalCentavos,
    })),
  };
}

/** Query de filtros del listado; también lo usa el export CSV. */
export class FiltroEstadoQuery {
  @IsOptional()
  @IsIn(ESTADOS_VENTA)
  estado?: EstadoVenta;
}
