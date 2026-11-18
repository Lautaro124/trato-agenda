/**
 * Estado del trato de un chat de ventas, como reglas puras. Lo marca el dueño
 * desde el panel de Inicio: "hecho" (acordaron la venta y queda el pedido
 * pendiente de pago), "pagado" o "cancelado".
 *
 * No hay una columna con el estado: sale del último pedido real del chat y de
 * la marca de cancelado (`Conversation.tratoCanceladoAt`). Así el pago que
 * llega por webhook o el pedido que arma el asistente lo actualizan solos.
 */
export const ESTADOS_TRATO = ['hecho', 'pagado', 'cancelado'] as const;
export type EstadoTrato = (typeof ESTADOS_TRATO)[number];

/** El último pedido del chat que no es del banco de pruebas. */
export type UltimoPedido = { estado: string; createdAt: Date } | null;

/**
 * La marca de cancelado vale si es posterior al último pedido: un pedido
 * nuevo (del asistente o del dueño) reabre el trato. Un pedido vencido no
 * cuenta como trato hecho: se cayó la reserva y nadie pagó.
 */
export function estadoDelTrato(pedido: UltimoPedido, canceladoAt: Date | null): EstadoTrato | null {
  if (canceladoAt && (!pedido || canceladoAt.getTime() >= pedido.createdAt.getTime())) return 'cancelado';
  if (!pedido) return null;
  if (pedido.estado === 'pagada') return 'pagado';
  if (pedido.estado === 'pendiente_pago') return 'hecho';
  if (pedido.estado === 'cancelada') return 'cancelado';
  return null;
}

/** Qué hay que hacer para llevar el chat al estado pedido, según su último pedido. */
export type PasoTrato =
  | { tipo: 'nada' }
  | { tipo: 'crear'; pagado: boolean }
  | { tipo: 'pagar' }
  | { tipo: 'cancelar_pedido' }
  | { tipo: 'marcar_cancelado' }
  | { tipo: 'rechazar'; motivo: string };

/**
 * Decide el paso sin tocar nada. Un pedido abierto (pendiente o vencido) se
 * reutiliza: no se arma otro encima. Uno pagado no se cancela desde acá.
 */
export function pasoParaTrato(destino: EstadoTrato, pedido: UltimoPedido): PasoTrato {
  const abierto = pedido !== null && (pedido.estado === 'pendiente_pago' || pedido.estado === 'vencida');
  const pagado = pedido?.estado === 'pagada';
  switch (destino) {
    case 'hecho':
      if (pagado) return { tipo: 'rechazar', motivo: 'Este chat ya tiene el pedido pagado.' };
      return abierto ? { tipo: 'nada' } : { tipo: 'crear', pagado: false };
    case 'pagado':
      if (pagado) return { tipo: 'nada' };
      return abierto ? { tipo: 'pagar' } : { tipo: 'crear', pagado: true };
    case 'cancelado':
      if (pagado) return { tipo: 'rechazar', motivo: 'Este chat ya tiene el pedido pagado: no se puede cancelar desde acá.' };
      return pedido?.estado === 'pendiente_pago' || pedido?.estado === 'vencida'
        ? { tipo: 'cancelar_pedido' }
        : { tipo: 'marcar_cancelado' };
  }
}
