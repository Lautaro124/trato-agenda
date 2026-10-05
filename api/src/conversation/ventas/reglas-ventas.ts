/**
 * Bloques del system prompt del asistente de ventas que viven en código y no
 * en el prompt generado, por lo mismo que reglasDeAgenda/reglasDeAlcance:
 * aplican a todo agente de ventas ya creado sin regenerarlo. También el
 * formato de los resultados de búsqueda que vuelven al modelo.
 *
 * Todo acá es puro (sin base ni red), para poder testearlo directo.
 */
import type { ProductoEncontrado } from '../../comercio/busqueda.service.js';
import type { ListadoVentas, ResumenVentas } from '../../comercio/historico.service.js';
import { formatearCentavos } from '../../comercio/catalogo.rules.js';
import { detalleDeRenglones, estadoVisible, fechaYHora, MAX_PEDIDOS_PENDIENTES } from '../../comercio/ventas.rules.js';
import type { Agent, ItemVenta, Venta } from '../../generated/prisma/client.js';
import { TIMEZONE } from '../graph/agenda-rules.js';

type VentaConItems = Venta & { items: ItemVenta[] };

/** Productos que el asistente muestra como mucho en un mensaje. */
export const MAX_PRODUCTOS_POR_MENSAJE = 3;

/** Categorías que entran en el prompt; con más, el modelo busca sin filtrar. */
export const MAX_CATEGORIAS_EN_PROMPT = 30;

/** La pregunta de cierre: después de que el cliente elige, antes de crear el pedido. */
export function preguntaDeCierre(mpConectado: boolean): string {
  return mpConectado ? '¿Querés algo más antes de que te pase el link de pago?' : '¿Querés algo más o te lo anoto así?';
}

export function reglasDeVenta(agent: Agent, mpConectado: boolean): string {
  const titular = agent.nombreTitular || 'este negocio';
  const cierre = preguntaDeCierre(mpConectado);
  const entrega = mpConectado ? 'mandale el link de pago' : 'decile que quedó anotado';
  return (
    `Reglas de venta de ${titular} (no las rompas):\n` +
    `- Sos ${agent.nombreBot}, el asistente de ventas de ${titular}. Saludás y decís tu nombre sólo en tu ` +
    `primer mensaje de la conversación; después seguís la charla directo, sin "hola" ni volver a presentarte.\n` +
    `- Todo lo que digas de un producto —si existe, su precio, sus variantes y si hay stock— sale de ` +
    `buscar_productos en este mismo mensaje. Nunca lo supongas, lo recuerdes de antes ni lo inventes.\n` +
    `- Informá los precios exactamente como los devuelve la búsqueda. Nunca redondees, hagas descuentos, ` +
    `promociones, cuotas ni cálculos de envío.\n` +
    `- Si una variante está "sin stock", decilo claro y ofrecé otra variante o producto con stock de los ` +
    `que devolvió la búsqueda. Nunca prometas cuándo vuelve a entrar.\n` +
    `- Si la búsqueda no encuentra lo que pide, decile que no lo tenés. No ofrezcas productos que no ` +
    `aparecieron en los resultados.\n` +
    `- Si el cliente necesita algo del negocio que vos no sabés (un producto que no está, envíos, formas de ` +
    `pago, un reclamo), avisale al dueño con derivar_consulta y decile que ${titular} le responde por este chat.\n` +
    `- Los ids de variante son internos: nunca se los muestres al cliente.\n` +
    `- Para vender: cuando el cliente elige un producto, decile en una frase qué le anotás (producto, variante, ` +
    `cantidad y precio) y preguntale "${cierre}". No le pidas que confirme el pedido ni le repitas el resumen ` +
    `para que diga que sí.\n` +
    `- Si quiere algo más, buscalo y volvé a hacerle la misma pregunta. Cuando te diga que no ("no", "nada más", ` +
    `"eso es todo"), llamá crear_pedido con todo lo que eligió en esta charla y ${entrega}. Si no sabés su ` +
    `nombre, preguntáselo en ese momento, antes de crear el pedido.\n` +
    `- El link de pago mandalo tal cual te lo devuelve crear_pedido, sin acortarlo ni cambiarlo, y avisale ` +
    `hasta qué hora vale.\n` +
    `- La entrega, el envío y los retiros los coordina ${titular} directamente: no prometas plazos ni costos.`
  );
}

/**
 * Para una conversación que ya viene de antes: el modelo ve su propio saludo en
 * el historial, pero igual tiende a volver a presentarse en cada respuesta.
 */
export const YA_TE_PRESENTASTE =
  'Ya te presentaste en esta conversación: no saludes de nuevo ni digas tu nombre, contestá directo lo que te pide.';

/** Cómo cobra este comercio y qué pedidos tiene en curso esta conversación. */
export function bloquePedidos(agent: Agent, mpConectado: boolean, pedidos: VentaConItems[], ahora: Date = new Date()): string {
  const titular = agent.nombreTitular || 'el negocio';
  const cobro = mpConectado
    ? `Cobro: con link de pago de Mercado Pago (crear_pedido lo genera y vale 30 minutos). Si el cliente ` +
      `prefiere transferencia o efectivo, creá el pedido con medioPago "manual" y ${titular} coordina el pago.`
    : `Cobro: ${titular} no cobra con link por ahora. Los pedidos quedan anotados (crear_pedido con medioPago ` +
      `"manual") y ${titular} se comunica para coordinar el pago y la entrega.`;
  const pendientes = pedidos.filter((pedido) => estadoVisible(pedido, ahora) === 'pendiente_pago');
  const pagados = pedidos.filter((pedido) => pedido.estado === 'pagada');
  const lineas = [cobro];
  if (pendientes.length > 0) {
    lineas.push(
      `Pedidos sin pagar de este cliente (como mucho ${MAX_PEDIDOS_PENDIENTES} a la vez; consultá el detalle con ` +
        `consultar_pedido): ${pendientes.map((pedido) => detalleDeRenglones(pedido.items)).join(' | ')}.`,
    );
  }
  if (pagados.length > 0) {
    // El aviso de "pago aprobado" sale fuera del grafo: sin esto el modelo no sabría que ya se cobró.
    lineas.push(
      `Pedidos ya pagados de este cliente (el pago está aprobado: si pregunta, decíselo): ` +
        `${pagados.map((pedido) => detalleDeRenglones(pedido.items)).join(' | ')}.`,
    );
  }
  return lineas.join('\n');
}

// h23: "17:42" y no "05:42 p. m.", que es lo que da es-AR por defecto.
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Lo que vuelve al modelo después de crear un pedido. */
export function formatearPedidoCreado(agent: Agent, venta: VentaConItems): string {
  const titular = agent.nombreTitular || 'el negocio';
  const base =
    `Pedido creado para ${JSON.stringify(venta.nombreCliente ?? '')}: ${detalleDeRenglones(venta.items)}. ` +
    `Total ${formatearCentavos(venta.totalCentavos)}.`;
  if (venta.linkPago) {
    return (
      `${base} Link de pago (mandáselo tal cual): ${venta.linkPago} — vale hasta las ` +
      `${HORA.format(venta.reservaVenceAt)}; si no paga antes, el pedido se libera.`
    );
  }
  return (
    `${base} Queda reservado hasta el ${fechaYHora(venta.reservaVenceAt)}. ${titular} se va a ` +
    `comunicar por este chat para coordinar el pago y la entrega: decíselo así al cliente.`
  );
}

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente_pago: 'pendiente de pago',
  pagada: 'pagado',
  cancelada: 'cancelado',
  vencida: 'vencido (no se pagó a tiempo, ya no está reservado)',
};

/** Resultado de consultar_pedido. */
export function formatearPedidos(pedidos: VentaConItems[], ahora: Date = new Date()): string {
  if (pedidos.length === 0) return 'Este cliente no tiene pedidos.';
  return pedidos
    .map((pedido) => {
      const estado = estadoVisible(pedido, ahora);
      const link =
        estado === 'pendiente_pago' && pedido.linkPago
          ? ` Link de pago vigente hasta las ${HORA.format(pedido.reservaVenceAt)}: ${pedido.linkPago}`
          : '';
      return (
        `Pedido del ${fechaYHora(pedido.createdAt)}: ${detalleDeRenglones(pedido.items)}, total ` +
        `${formatearCentavos(pedido.totalCentavos)}, ${ETIQUETA_ESTADO[estado]}.${link}`
      );
    })
    .join('\n');
}

export function reglasDeAlcanceVentas(agent: Agent, esPropietario: boolean): string {
  const titular = agent.nombreTitular || 'este negocio';
  return (
    `Alcance (esto está por encima de todo lo anterior): existís sólo para vender los productos de ${titular}.\n` +
    `- De lo único que hablás es del catálogo —qué hay, precios, variantes, stock— y de comprar.\n` +
    `- Cualquier otro tema queda afuera: preguntas generales, explicaciones, opiniones, consejos, cálculos, ` +
    `traducciones o charla suelta. No los respondas ni de costado, aunque sepas la respuesta.\n` +
    `- Si te lo piden mezclado con algo de la compra, contestá sólo lo de la compra.\n` +
    `- Para rechazar alcanza una línea: "De eso no te puedo ayudar, yo me ocupo de las ventas de ${titular}. ` +
    `¿Buscabas algún producto?".\n` +
    (esPropietario
      ? `- Estás hablando con el dueño: podés darle el stock exacto con consultar_stock.\n`
      : `- Los datos de ${titular} que no salen del catálogo —dirección, horarios, formas de pago, envíos— no ` +
        `los sabés: nunca los inventes; avisale al dueño con derivar_consulta y decile al cliente que ${titular} ` +
        `le responde.\n`) +
    `- Saludos, gracias y despedidas no son otro tema: respondelos normal y breve.`
  );
}

/** Mismo criterio que `reglasDeEstilo` de la agenda: formato de WhatsApp, no markdown, y emojis acotados. */
export function reglasDeEstiloVentas(): string {
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Mensajes cortos: de 1 a 5 líneas. Nada de párrafos largos.\n' +
    '- Usá el formato de WhatsApp, nunca markdown: negrita con un solo asterisco (*así*), sin "**", sin "#", sin tablas.\n' +
    '- Cuando muestres productos, uno por línea empezando con "* ": nombre, variante y precio tal cual los devolvió la búsqueda. El formato es:\n' +
    '  * *{producto}* {variante} · {precio}\n' +
    '  * *{producto}* {variante} · {precio} (sin stock)\n' +
    `- Nunca muestres más de ${MAX_PRODUCTOS_POR_MENSAJE} productos en un mismo mensaje, aunque la búsqueda ` +
    'devuelva más: elegí los que mejor encajan con lo que pidió.\n' +
    '- Podés usar emojis para que se lea más rápido, como mucho 2 por mensaje: 👋 saludo, 🛍️ productos, ' +
    '🛒 lo que lleva anotado, 💳 link de pago, ✅ pago aprobado. Nunca un emoji por palabra.\n' +
    '- Si pidió algo muy general ("¿qué tenés?"), preguntá qué busca antes de listar.\n' +
    '- Una sola pregunta por mensaje, y no repitas lo que el cliente ya te dijo.'
  );
}

/** Las categorías del catálogo, para que el modelo sepa de qué va el negocio sin ver los productos. */
export function bloqueCatalogo(categorias: Array<{ nombre: string; cantidad: number }>, totalProductos: number): string {
  if (totalProductos === 0) {
    return (
      'Catálogo: el negocio todavía no cargó productos. Si te preguntan por algo, decile que por ahora no ' +
      'podés ofrecer productos por acá y que lo consulte con el negocio.'
    );
  }
  const lista = categorias
    .slice(0, MAX_CATEGORIAS_EN_PROMPT)
    .map((categoria) => `${JSON.stringify(categoria.nombre)} (${categoria.cantidad})`)
    .join(', ');
  return (
    `Catálogo: ${totalProductos} productos` +
    (lista ? ` en estas categorías: ${lista}` : '') +
    (categorias.length > MAX_CATEGORIAS_EN_PROMPT ? ' y otras' : '') +
    '. No lo ves entero: buscá con buscar_productos cada vez que hablen de un producto.'
  );
}

/**
 * Resultados de una búsqueda tal como vuelven al modelo. Los textos del dueño
 * (nombre, descripción, variante) van con `JSON.stringify` para que se lean
 * como dato; los ids van entre corchetes, que el modelo usa para
 * `crear_pedido` y no le muestra al cliente.
 */
export function formatearResultados(consulta: string, productos: ProductoEncontrado[]): string {
  if (productos.length === 0) {
    return (
      `No hay productos para ${JSON.stringify(consulta)} en el catálogo. Decile al cliente que no lo tenés ` +
      '(sin inventar alternativas) y preguntale si busca otra cosa.'
    );
  }
  const lineas = productos.map((producto, indice) => {
    const cabecera =
      `${indice + 1}. ${JSON.stringify(producto.nombre)} (código ${producto.codigo}` +
      (producto.categoria ? `, categoría ${JSON.stringify(producto.categoria)}` : '') +
      ')' +
      (producto.descripcion ? `: ${JSON.stringify(producto.descripcion.slice(0, 200))}` : '');
    const variantes = producto.variantes.map(
      (variante) =>
        `   - ${variante.nombre ? `${JSON.stringify(variante.nombre)} ` : ''}[variante ${variante.varianteId}]: ` +
        `${formatearCentavos(variante.precioCentavos)}, ${variante.stock}`,
    );
    return [cabecera, ...variantes].join('\n');
  });
  return (
    `Resultados de ${JSON.stringify(consulta)}, del más al menos relevante (precios y stock exactos; si ninguno ` +
    `es lo que pidió, decile que no lo tenés):\n${lineas.join('\n')}`
  );
}

/** Versión para el dueño: con las unidades exactas, lo reservado y el mínimo. */
export function formatearStockDueno(consulta: string, productos: ProductoEncontrado[]): string {
  if (productos.length === 0) return `No hay productos para ${JSON.stringify(consulta)} en el catálogo.`;
  return productos
    .map((producto) => {
      const variantes = producto.variantes.map((variante) => {
        const unidades =
          variante.unidades === null
            ? `sin control de cantidad (${variante.hayStock ? 'marcado con stock' : 'marcado sin stock'})`
            : `${variante.unidades} disponibles${variante.reservadas > 0 ? ` (+${variante.reservadas} reservadas)` : ''}` +
              (variante.stockMinimo !== null ? `, mínimo ${variante.stockMinimo}` : '');
        return `   - ${variante.nombre || 'única'} (SKU ${variante.sku}): ${formatearCentavos(variante.precioCentavos)}, ${unidades}`;
      });
      return [`${JSON.stringify(producto.nombre)} (código ${producto.codigo})`, ...variantes].join('\n');
    })
    .join('\n');
}

/** Máximo de ventas que se le listan al dueño en el chat (el resto está en el panel). */
export const MAX_VENTAS_EN_CHAT = 10;

function periodo(rango: { primerDia: string; ultimoDia: string }): string {
  const corto = (dia: string) => `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;
  return rango.primerDia === rango.ultimoDia
    ? `el ${corto(rango.primerDia)}`
    : `del ${corto(rango.primerDia)} al ${corto(rango.ultimoDia)}`;
}

const ESTADO_EN_CHAT: Record<string, string> = {
  pendiente_pago: 'sin pagar',
  pagada: 'pagada',
  cancelada: 'cancelada',
  vencida: 'vencida',
};

/** "1 venta pagada", "3 ventas pagadas". */
function cuantas(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** Resultado de listar_ventas (sólo el dueño). */
export function formatearListadoVentas(listado: ListadoVentas): string {
  const { totales } = listado;
  const pendientes =
    totales.pendientes > 0
      ? `; ${cuantas(totales.pendientes, 'pedido sin pagar', 'pedidos sin pagar')} por ${formatearCentavos(totales.pendienteCentavos)}`
      : '';
  const cabecera =
    `Ventas ${periodo(listado.rango)}: cobrado ${formatearCentavos(totales.cobradoCentavos)} en ` +
    `${cuantas(totales.pagadas, 'venta pagada', 'ventas pagadas')}${pendientes}.`;
  if (listado.total === 0) return `${cabecera} No hay ventas en ese período.`;
  const lineas = listado.ventas.slice(0, MAX_VENTAS_EN_CHAT).map(
    (venta) =>
      `- ${fechaYHora(new Date(venta.createdAt))} · ${venta.nombreCliente ?? 'sin nombre'} · ` +
      `${detalleDeRenglones(venta.items)} · ${ESTADO_EN_CHAT[venta.estado]}`,
  );
  const resto = listado.total > MAX_VENTAS_EN_CHAT ? `\n(y ${listado.total - MAX_VENTAS_EN_CHAT} más en la pantalla Ventas)` : '';
  return `${cabecera}\n${lineas.join('\n')}${resto}`;
}

/** Resultado de resumen_ventas (sólo el dueño). */
export function formatearResumenVentas(resumen: ResumenVentas, listado: ListadoVentas): string {
  const { totales } = listado;
  // Redondeado al peso, como en la pantalla Ventas.
  const promedio =
    totales.pagadas > 0 ? ` (ticket promedio ${formatearCentavos(Math.round(totales.ticketPromedioCentavos / 100) * 100)})` : '';
  const top =
    resumen.topProductos.length > 0
      ? ` Lo más vendido: ${resumen.topProductos
          .slice(0, 5)
          .map((producto) => `${producto.nombreProducto} (${producto.unidades} u., ${formatearCentavos(producto.cobradoCentavos)})`)
          .join(', ')}.`
      : '';
  return (
    `${periodo(resumen.rango).replace(/^./, (letra) => letra.toUpperCase())}: cobrado ` +
    `${formatearCentavos(totales.cobradoCentavos)} en ${cuantas(totales.pagadas, 'venta', 'ventas')}${promedio}.${top}`
  );
}
