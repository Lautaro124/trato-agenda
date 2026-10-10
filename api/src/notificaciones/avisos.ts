/**
 * Textos de los avisos al dueño, como funciones puras: el mismo texto va a la
 * campanita del panel y a su propio chat de WhatsApp.
 */
import { formatearCentavos } from '../comercio/catalogo.rules.js';
import { detalleDeRenglones, fechaYHora, type RenglonVenta } from '../comercio/ventas.rules.js';

export const TIPOS_NOTIFICACION = [
  'venta_pagada',
  'pedido_manual',
  'stock_bajo',
  'stock_agotado',
  'consulta_derivada',
  'mercadopago_desconectado',
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
  totalCentavos: number;
  medioPago: string;
  reservaVenceAt: Date;
  sinStockAlPagar: boolean;
  dePrueba: boolean;
  items: RenglonVenta[];
};

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
    titulo: `${prueba(venta)}Venta pagada: ${formatearCentavos(venta.totalCentavos)}`,
    cuerpo:
      `${quien(venta)} pagó ${detalleDeRenglones(venta.items)} por Mercado Pago. ` +
      `Coordiná la entrega por WhatsApp.${alerta}`,
    enlace: `/ventas?venta=${venta.id}`,
  };
}

export function avisoPedidoManual(venta: VentaAvisable): Aviso {
  return {
    tipo: 'pedido_manual',
    titulo: `${prueba(venta)}Pedido para cobrar: ${formatearCentavos(venta.totalCentavos)}`,
    cuerpo:
      `${quien(venta)} pidió ${detalleDeRenglones(venta.items)}. Queda reservado hasta el ` +
      `${fechaYHora(venta.reservaVenceAt)}. Cobrale por WhatsApp y marcalo pagado en Ventas.`,
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
  return {
    tipo: 'consulta_derivada',
    titulo: `${prueba(consulta)}Consulta de un cliente`,
    cuerpo: `${quien(consulta)} preguntó algo que el asistente no sabe responder: "${consulta.resumen.slice(0, LARGO_MAX_CONSULTA)}".`,
    // Una por conversación mientras siga sin leer (y además HORAS_ENTRE_CONSULTAS).
    clave: `consulta:${consulta.conversationId}`,
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

/** El texto que va al chat propio de WhatsApp: título y cuerpo, sin nada más. */
export function textoParaWhatsapp(aviso: Pick<Aviso, 'titulo' | 'cuerpo'>): string {
  return `${aviso.titulo}\n${aviso.cuerpo}`;
}
