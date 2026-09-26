/**
 * Reglas de los pedidos como funciones puras, igual que subscription.rules.ts:
 * la reserva de stock no es una fila, es una regla sobre `Venta` (estado +
 * vencimiento), así que no hace falta ningún proceso que la "libere" para
 * que el stock vuelva a estar disponible.
 */
import { formatearCentavos } from './catalogo.rules.js';

/** Lo que dura la reserva de un pedido con link de Mercado Pago (el link vence a la vez). */
export const MINUTOS_RESERVA_MP = 30;

/** Lo que dura la reserva de un pedido a cobrar a mano (transferencia, efectivo). */
export const HORAS_RESERVA_MANUAL = 24;

/**
 * Pedidos pendientes a la vez en una misma conversación. Sin tope, un cliente
 * (o un bot haciéndose pasar por uno) podría reservar todo el stock del
 * comercio pidiendo y no pagando.
 */
export const MAX_PEDIDOS_PENDIENTES = 2;

/** Renglones por pedido y unidades por renglón. */
export const MAX_ITEMS_POR_PEDIDO = 10;
export const MAX_CANTIDAD_POR_ITEM = 50;

export const ESTADOS_VENTA = ['pendiente_pago', 'pagada', 'cancelada', 'vencida'] as const;
export type EstadoVenta = (typeof ESTADOS_VENTA)[number];

export const MEDIOS_DE_PAGO = ['mercadopago', 'manual'] as const;
export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number];

type VentaReservable = { estado: string; reservaVenceAt: Date };

/** true mientras la venta retiene su stock: pendiente y sin vencer. */
export function reservaVigente(venta: VentaReservable, ahora: Date = new Date()): boolean {
  return venta.estado === 'pendiente_pago' && venta.reservaVenceAt.getTime() > ahora.getTime();
}

/** El estado que corresponde mostrar: una pendiente cuya reserva venció ya es "vencida". */
export function estadoVisible(venta: VentaReservable, ahora: Date = new Date()): EstadoVenta {
  if (venta.estado === 'pendiente_pago' && !reservaVigente(venta, ahora)) return 'vencida';
  return (ESTADOS_VENTA as readonly string[]).includes(venta.estado) ? (venta.estado as EstadoVenta) : 'cancelada';
}

export function vencimientoDeReserva(medio: MedioDePago, ahora: Date = new Date()): Date {
  const minutos = medio === 'mercadopago' ? MINUTOS_RESERVA_MP : HORAS_RESERVA_MANUAL * 60;
  return new Date(ahora.getTime() + minutos * 60_000);
}

export type ItemPedido = { varianteId: string; cantidad: number };

/**
 * Junta renglones repetidos de la misma variante ("2 mates" y "1 mate más")
 * en uno, así el control de stock mira la cantidad total.
 */
export function agruparItems(items: ItemPedido[]): ItemPedido[] {
  const porVariante = new Map<string, number>();
  for (const item of items) porVariante.set(item.varianteId, (porVariante.get(item.varianteId) ?? 0) + item.cantidad);
  return [...porVariante.entries()].map(([varianteId, cantidad]) => ({ varianteId, cantidad }));
}

/** Motivo por el que un pedido no se puede ni intentar, o null si la forma es válida. */
export function problemaDeForma(items: ItemPedido[]): string | null {
  if (items.length === 0) return 'El pedido no tiene productos.';
  const agrupados = agruparItems(items);
  if (agrupados.length > MAX_ITEMS_POR_PEDIDO) {
    return `Un pedido puede tener hasta ${MAX_ITEMS_POR_PEDIDO} productos distintos.`;
  }
  for (const item of agrupados) {
    if (!Number.isInteger(item.cantidad) || item.cantidad < 1) return 'Cada cantidad tiene que ser un número entero mayor que cero.';
    if (item.cantidad > MAX_CANTIDAD_POR_ITEM) {
      return `Por este medio se pueden pedir hasta ${MAX_CANTIDAD_POR_ITEM} unidades de cada producto; para más, que consulte con el negocio.`;
    }
  }
  return null;
}

/**
 * ¿El pago de Mercado Pago salda esta venta? Además de `approved`, el monto y
 * la moneda tienen que ser exactamente los de la venta: el link lo arma la API
 * con precios de la base, así que un pago por otro importe no es este pedido.
 */
export function pagoSaldaVenta(
  pago: { status: string; external_reference?: string | null; transaction_amount: number; currency_id: string },
  venta: { id: string; totalCentavos: number; moneda: string },
): boolean {
  return (
    pago.status === 'approved' &&
    pago.external_reference === venta.id &&
    pago.currency_id === venta.moneda &&
    Math.round(pago.transaction_amount * 100) === venta.totalCentavos
  );
}

/** Número de WhatsApp de un remoteJid de Baileys ("54911…@s.whatsapp.net" → "54911…"). */
export function telefonoDeJid(remoteJid: string): string | null {
  const [usuario, dominio] = remoteJid.split('@');
  if (dominio !== 's.whatsapp.net' || !/^\d{6,15}$/.test(usuario)) return null;
  return usuario;
}

export type RenglonVenta = {
  nombreProducto: string;
  nombreVariante: string;
  cantidad: number;
  subtotalCentavos: number;
};

/** "2 × Mate de calabaza ($ 16.000), 1 × Remera (Talle M) ($ 15.000)". */
export function detalleDeRenglones(items: RenglonVenta[]): string {
  return items
    .map(
      (item) =>
        `${item.cantidad} × ${item.nombreProducto}${item.nombreVariante ? ` (${item.nombreVariante})` : ''} ` +
        `(${formatearCentavos(item.subtotalCentavos)})`,
    )
    .join(', ');
}
