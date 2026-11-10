/**
 * Textos de los avisos al dueño, como funciones puras: el mismo texto va a la
 * campanita del panel y a su propio chat de WhatsApp.
 */
import { formatearMonto } from '../comercio/catalogo.rules.js';
import { detalleDePedido, fechaYHora, type RenglonVenta } from '../comercio/ventas.rules.js';

export const TIPOS_NOTIFICACION = [
  'venta_pagada',
  'pedido_manual',
  'stock_bajo',
  'stock_agotado',
  'consulta_derivada',
  'mercadopago_desconectado',
  'whatsapp_desconectado',
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
  /** "efectivo" | "cuotas" (LAU-34); ausente o null = contado. */
  formaPago?: string | null;
  cuotas?: number | null;
  /** Envío que va en el pedido (LAU-102); ausente = sin envío en el total. */
  envioModalidad?: string | null;
  envioCentavos?: number;
  /** Con qué destino se cotizó ese envío. */
  envioDestino?: string | null;
  reservaVenceAt: Date | null;
  sinStockAlPagar: boolean;
  dePrueba: boolean;
  /** Sólo si se envía o se retira; la dirección no viaja en el aviso (está en Ventas). */
  entrega?: string | null;
  /** "humana" si el chat quedó para el negocio (cobro manual configurado). */
  atencion?: string;
  items: RenglonVenta[];
};

function formaDePago(venta: Pick<VentaAvisable, 'formaPago' | 'cuotas'>): string {
  if (venta.formaPago === 'efectivo') return ' Paga en efectivo (ya tiene el descuento).';
  if (venta.formaPago === 'cuotas' && venta.cuotas) return ` Eligió pagar en ${venta.cuotas} cuotas.`;
  return '';
}

function entrega(venta: Pick<VentaAvisable, 'entrega' | 'envioDestino'>): string {
  if (venta.entrega === 'envio' && venta.envioDestino) {
    return (
      ` Es con envío, cotizado para ${venta.envioDestino}: antes de despachar, revisá en Ventas que coincida con ` +
      'la dirección.'
    );
  }
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
      `${quien(venta)} pagó ${detalleDePedido(venta)} por Mercado Pago. ` +
      `Coordiná la entrega por WhatsApp.${entrega(venta)}${alerta}`,
    enlace: `/ventas?venta=${venta.id}`,
  };
}

export function avisoPedidoManual(venta: VentaAvisable): Aviso {
  return {
    tipo: 'pedido_manual',
    titulo: `${prueba(venta)}Pedido para cobrar: ${formatearMonto(venta.totalCentavos ?? 0, venta.moneda)}`,
    cuerpo:
      `${quien(venta)} pidió ${detalleDePedido(venta)}.` +
      (venta.reservaVenceAt ? ` Queda reservado hasta el ${fechaYHora(venta.reservaVenceAt)}.` : '') +
      `${formaDePago(venta)} Cobrale por WhatsApp y marcalo pagado en Ventas.${entrega(venta)}` +
      (venta.atencion === 'humana' ? ` ${PAUSA_HASTA_QUE_ACTUES}` : ''),
    enlace: `/ventas?venta=${venta.id}`,
  };
}

export function avisoStock(producto: { productoId: string; nombreProducto: string; stock: number }): Aviso {
  const nombre = producto.nombreProducto;
  const agotado = producto.stock <= 0;
  return {
    tipo: agotado ? 'stock_agotado' : 'stock_bajo',
    titulo: agotado ? `Sin stock: ${nombre}` : `Stock bajo: ${nombre}`,
    cuerpo: agotado
      ? `Se vendió lo último de ${nombre}. El asistente ya les dice a los clientes que no hay.`
      : `Quedan ${producto.stock} unidades de ${nombre}.`,
    enlace: '/productos',
    clave: `stock:${producto.productoId}`,
  };
}

export function avisoConsultaDerivada(consulta: {
  conversationId: string;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  resumen: string;
  dePrueba: boolean;
}): Aviso {
  const resumen = consulta.resumen.slice(0, LARGO_MAX_CONSULTA);
  return {
    tipo: 'consulta_derivada',
    titulo: `${prueba(consulta)}Consulta de un cliente`,
    cuerpo: `${quien(consulta)} preguntó algo que el asistente no sabe responder: "${resumen}".`,
    // Una por conversación mientras siga sin leer (y además HORAS_ENTRE_CONSULTAS).
    clave: `consulta:${consulta.conversationId}`,
  };
}

/** Lo que se le dice al dueño cuando un cobro manual deja el chat en sus manos. */
const PAUSA_HASTA_QUE_ACTUES =
  'Tu asistente no contesta en ese chat hasta que se lo devuelvas desde Chats o desde el pedido.';

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
  usados: number;
  limite: number;
  superado: boolean;
  etiquetaMes: string;
}): Aviso {
  const titulo = datos.superado
    ? `Llegaste al tope de ${datos.limite} chats del mes`
    : `Ya usaste ${datos.usados} de ${datos.limite} chats este mes`;
  return {
    tipo: 'cupo_chats',
    titulo,
    cuerpo: `Cada cliente distinto que te escribe en el mes cuenta como un chat. El asistente sigue contestando igual.`,
    enlace: '/plan',
    clave: `cupo_chats:${datos.superado ? '100' : '80'}:${datos.etiquetaMes}`,
  };
}
