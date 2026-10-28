/**
 * Textos de los avisos al dueño, como funciones puras: el mismo texto va a la
 * campanita del panel y a su propio chat de WhatsApp.
 */
import { formatearCentavos, formatearMonto } from '../comercio/catalogo.rules.js';
import { PLANES } from '../subscription/subscription.rules.js';
import { detalleDeRenglones, fechaYHora, type RenglonVenta } from '../comercio/ventas.rules.js';

export const TIPOS_NOTIFICACION = [
  'venta_pagada',
  'pedido_manual',
  'stock_bajo',
  'stock_agotado',
  'consulta_derivada',
  'mercadopago_desconectado',
  'whatsapp_desconectado',
  'solicitud_a_cotizar',
  'presupuesto_a_revisar',
  'pedido_derivado',
  'presupuesto_aceptado',
  'cupo_chats',
] as const;

export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export type Aviso = {
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo: string;
  /** Ruta del panel a la que lleva. */
  enlace?: string;
  /** Con clave, no se repite mientras haya uno igual sin leer. */
  clave?: string;
};

/** Tope de lo que el cliente escribió que llega a un aviso (consultas derivadas). */
export const LARGO_MAX_CONSULTA = 300;

type VentaAvisable = {
  id: string;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  totalCentavos: number | null;
  /** Ausente = pesos. */
  moneda?: string;
  medioPago: string | null;
  reservaVenceAt: Date | null;
  sinStockAlPagar: boolean;
  dePrueba: boolean;
  /** Sólo si se envía o se retira; la dirección no viaja en el aviso (está en Ventas). */
  entrega?: string | null;
  items: RenglonVenta[];
};

function entrega(venta: Pick<VentaAvisable, 'entrega'>): string {
  if (venta.entrega === 'envio') return ' Es con envío: los datos están en Ventas.';
  if (venta.entrega === 'retiro') return ' Lo retira.';
  return '';
}

function quien(venta: Pick<VentaAvisable, 'nombreCliente' | 'telefonoCliente'>): string {
  const nombre = venta.nombreCliente?.trim() || 'Un cliente';
  return venta.telefonoCliente ? `${nombre} (+${venta.telefonoCliente})` : nombre;
}

function prueba(venta: Pick<VentaAvisable, 'dePrueba'>): string {
  return venta.dePrueba ? '[Prueba] ' : '';
}

export function avisoVentaPagada(venta: VentaAvisable): Aviso {
  const alerta = venta.sinStockAlPagar
    ? ' Atención: se pagó cuando ya no había stock para cubrirlo (la reserva había vencido). Devolvé el pago o reponé.'
    : '';
  return {
    tipo: 'venta_pagada',
    titulo: `${prueba(venta)}Venta pagada: ${formatearMonto(venta.totalCentavos ?? 0, venta.moneda)}`,
    cuerpo:
      `${quien(venta)} pagó ${detalleDeRenglones(venta.items, venta.moneda)} por Mercado Pago. ` +
      `Coordiná la entrega por WhatsApp.${entrega(venta)}${alerta}`,
    enlace: `/ventas?venta=${venta.id}`,
  };
}

export function avisoPedidoManual(venta: VentaAvisable): Aviso {
  return {
    tipo: 'pedido_manual',
    titulo: `${prueba(venta)}Pedido para cobrar: ${formatearMonto(venta.totalCentavos ?? 0, venta.moneda)}`,
    cuerpo:
      `${quien(venta)} pidió ${detalleDeRenglones(venta.items, venta.moneda)}.` +
      (venta.reservaVenceAt ? ` Queda reservado hasta el ${fechaYHora(venta.reservaVenceAt)}.` : '') +
      ` Cobrale por WhatsApp y marcalo pagado en Ventas.${entrega(venta)}`,
    enlace: `/ventas?venta=${venta.id}`,
  };
}

export function avisoStock(variante: {
  varianteId: string;
  nombreProducto: string;
  nombreVariante: string;
  stock: number;
}): Aviso {
  const nombre = `${variante.nombreProducto}${variante.nombreVariante ? ` (${variante.nombreVariante})` : ''}`;
  const agotado = variante.stock <= 0;
  return {
    tipo: agotado ? 'stock_agotado' : 'stock_bajo',
    titulo: agotado ? `Sin stock: ${nombre}` : `Stock bajo: ${nombre}`,
    cuerpo: agotado
      ? `Se vendió lo último de ${nombre}. El asistente ya les dice a los clientes que no hay.`
      : `Quedan ${variante.stock} unidades de ${nombre}.`,
    enlace: '/productos',
    clave: `stock:${variante.varianteId}`,
  };
}

export function avisoConsultaDerivada(consulta: {
  conversationId: string;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  resumen: string;
  dePrueba: boolean;
}): Aviso {
  // Las solicitudes para cotizar tienen sus propios avisos (registrar_solicitud): esto es siempre una consulta.
  const resumen = consulta.resumen.slice(0, LARGO_MAX_CONSULTA);
  return {
    tipo: 'consulta_derivada',
    titulo: `${prueba(consulta)}Consulta de un cliente`,
    cuerpo: `${quien(consulta)} preguntó algo que el asistente no sabe responder: "${resumen}".`,
    // Una por conversación mientras siga sin leer (y además HORAS_ENTRE_CONSULTAS).
    clave: `consulta:${consulta.conversationId}`,
  };
}

/** Lo que hace falta de un pedido a medida para avisar sobre él. */
type PedidoAMedidaAvisable = {
  ventaId: string;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  nombreProducto: string | null;
  dePrueba: boolean;
};

function deQue(pedido: Pick<PedidoAMedidaAvisable, 'nombreProducto'>): string {
  return pedido.nombreProducto ? ` de ${JSON.stringify(pedido.nombreProducto)}` : '';
}

/** Una solicitud a medida que espera precio: la armás vos desde Ventas. */
export function avisoSolicitudACotizar(
  pedido: PedidoAMedidaAvisable & { resumen: string; motivo?: string | null; variante?: string | null },
): Aviso {
  const resumen = pedido.resumen.slice(0, LARGO_MAX_CONSULTA);
  const variante = pedido.variante ? pedido.variante.slice(0, LARGO_MAX_CONSULTA) : '';
  return {
    tipo: 'solicitud_a_cotizar',
    titulo: `${prueba(pedido)}Para cotizar${pedido.nombreProducto ? `: ${pedido.nombreProducto}` : ''}`,
    cuerpo:
      `${quien(pedido)} pidió un presupuesto${deQue(pedido)}${resumen ? `: "${resumen}"` : ''}. ` +
      (variante ? `${variante}. ` : '') +
      (pedido.motivo ? `${pedido.motivo} ` : '') +
      'Armalo y mandáselo desde Ventas.',
    enlace: `/ventas?venta=${pedido.ventaId}`,
    clave: `cotizar:${pedido.ventaId}`,
  };
}

/** El asistente armó el presupuesto con la receta y espera que lo apruebes. */
export function avisoPresupuestoARevisar(pedido: PedidoAMedidaAvisable & { totalCentavos: number }): Aviso {
  return {
    tipo: 'presupuesto_a_revisar',
    titulo: `${prueba(pedido)}Presupuesto para revisar: ${formatearCentavos(pedido.totalCentavos)}`,
    cuerpo:
      `El asistente armó el presupuesto${deQue(pedido)} para ${quien(pedido)}. ` +
      'Revisalo en Ventas: hasta que lo apruebes no le llega al cliente.',
    enlace: `/ventas?venta=${pedido.ventaId}`,
    clave: `revisar:${pedido.ventaId}`,
  };
}

/** El pedido pasó a una persona: el asistente ya no contesta en ese chat. */
export function avisoPedidoDerivado(
  pedido: PedidoAMedidaAvisable & { motivo: string; detalle: string | null },
): Aviso {
  const detalle = pedido.detalle?.slice(0, LARGO_MAX_CONSULTA);
  return {
    tipo: 'pedido_derivado',
    titulo: `${prueba(pedido)}Un cliente te espera${pedido.nombreProducto ? `: ${pedido.nombreProducto}` : ''}`,
    cuerpo:
      `${quien(pedido)} necesita que lo atienda una persona (${pedido.motivo})${detalle ? `: "${detalle}"` : ''}. ` +
      'El asistente no contesta en ese chat hasta que se lo devuelvas desde Ventas.',
    enlace: `/ventas?venta=${pedido.ventaId}`,
    clave: `derivado:${pedido.ventaId}`,
  };
}

/** El cliente aceptó un presupuesto que se cobra a mano. */
export function avisoPresupuestoAceptado(
  pedido: PedidoAMedidaAvisable & { totalCentavos: number; entrega?: string | null },
): Aviso {
  return {
    tipo: 'presupuesto_aceptado',
    titulo: `${prueba(pedido)}Aceptó el presupuesto: ${formatearCentavos(pedido.totalCentavos)}`,
    cuerpo: `${quien(pedido)} aceptó el presupuesto${deQue(pedido)}.${entrega(pedido)} Cobrale por WhatsApp y marcalo pagado en Ventas.`,
    enlace: `/ventas?venta=${pedido.ventaId}`,
  };
}

export function avisoMercadoPagoDesconectado(): Aviso {
  return {
    tipo: 'mercadopago_desconectado',
    titulo: 'Mercado Pago se desconectó',
    cuerpo:
      'Tu cuenta de Mercado Pago dejó de autorizar a Trato, así que el asistente ya no manda links de ' +
      'pago: los pedidos quedan para cobrar a mano. Volvé a conectarla desde Cuenta.',
    enlace: '/cuenta',
    clave: 'mercadopago',
  };
}

/**
 * La sesión vinculada lleva un rato sin poder conectarse y se sigue
 * reintentando sola. Por WhatsApp no va a llegar (justamente), pero queda en
 * la campanita.
 */
export function avisoWhatsappCaido(minutos: number): Aviso {
  return {
    tipo: 'whatsapp_desconectado',
    titulo: 'Tu WhatsApp se desconectó',
    cuerpo:
      `Hace más de ${minutos} minutos que el asistente no se puede conectar a tu WhatsApp, así que no está ` +
      'contestando. Seguimos intentando solos; si no vuelve, revisá que el teléfono tenga internet.',
    enlace: '/inicio',
    clave: 'whatsapp',
  };
}

/** WhatsApp rechazó la sesión y reintentar no la arregla: hay que volver a vincular. */
export function avisoWhatsappParaVolverAVincular(): Aviso {
  return {
    tipo: 'whatsapp_desconectado',
    titulo: 'Volvé a vincular tu WhatsApp',
    cuerpo:
      'WhatsApp dejó de aceptar la sesión del asistente y no va a contestar hasta que lo vuelvas a ' +
      'vincular escaneando el QR.',
    enlace: '/vincular',
    clave: 'whatsapp-vincular',
  };
}

/** El texto que va al chat propio de WhatsApp: título y cuerpo, sin nada más. */
export function textoParaWhatsapp(aviso: Pick<Aviso, 'titulo' | 'cuerpo'>): string {
  return `${aviso.titulo}\n${aviso.cuerpo}`;
}

/** Aviso de cupo de chats del mes: sólo informa, el asistente sigue contestando. */
export function avisoCupoDeChats(datos: {
  plan: string | null;
  usados: number;
  limite: number;
  superado: boolean;
  etiquetaMes: string;
}): Aviso {
  const titulo = datos.superado
    ? `Llegaste al tope de ${datos.limite} chats del mes`
    : `Ya usaste ${datos.usados} de ${datos.limite} chats este mes`;
  const cierre =
    datos.plan === 'pro'
      ? 'El asistente sigue contestando igual.'
      : `El asistente sigue contestando igual; si querés más margen, podés pasarte al plan Pro (${PLANES.pro.chats.toLocaleString('es-AR')} chats).`;
  return {
    tipo: 'cupo_chats',
    titulo,
    cuerpo: `Cada cliente distinto que te escribe en el mes cuenta como un chat. ${cierre}`,
    enlace: '/plan',
    clave: `cupo_chats:${datos.superado ? '100' : '80'}:${datos.etiquetaMes}`,
  };
}
