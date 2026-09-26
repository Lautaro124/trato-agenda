/**
 * Bloques del system prompt del asistente de ventas que viven en código y no
 * en el prompt generado, por lo mismo que reglasDeAgenda/reglasDeAlcance:
 * aplican a todo agente de ventas ya creado sin regenerarlo. También el
 * formato de los resultados de búsqueda que vuelven al modelo.
 *
 * Todo acá es puro (sin base ni red), para poder testearlo directo.
 */
import type { ProductoEncontrado } from '../../comercio/busqueda.service.js';
import { formatearCentavos } from '../../comercio/catalogo.rules.js';
import { detalleDeRenglones, estadoVisible, MAX_PEDIDOS_PENDIENTES } from '../../comercio/ventas.rules.js';
import type { Agent, ItemVenta, Venta } from '../../generated/prisma/client.js';
import { TIMEZONE } from '../graph/agenda-rules.js';

type VentaConItems = Venta & { items: ItemVenta[] };

/** Productos que el asistente muestra como mucho en un mensaje. */
export const MAX_PRODUCTOS_POR_MENSAJE = 3;

/** Categorías que entran en el prompt; con más, el modelo busca sin filtrar. */
export const MAX_CATEGORIAS_EN_PROMPT = 30;

export function reglasDeVenta(agent: Agent): string {
  const titular = agent.nombreTitular || 'este negocio';
  return (
    `Reglas de venta de ${titular} (no las rompas):\n` +
    `- Te llamás ${agent.nombreBot} y sos el asistente de ventas de ${titular}.\n` +
    `- Todo lo que digas de un producto —si existe, su precio, sus variantes y si hay stock— sale de ` +
    `buscar_productos en este mismo mensaje. Nunca lo supongas, lo recuerdes de antes ni lo inventes.\n` +
    `- Informá los precios exactamente como los devuelve la búsqueda. Nunca redondees, hagas descuentos, ` +
    `promociones, cuotas ni cálculos de envío.\n` +
    `- Si una variante está "sin stock", decilo claro y ofrecé otra variante o producto con stock de los ` +
    `que devolvió la búsqueda. Nunca prometas cuándo vuelve a entrar.\n` +
    `- Si la búsqueda no encuentra lo que pide, decile que no lo tenés. No ofrezcas productos que no ` +
    `aparecieron en los resultados.\n` +
    `- Los ids de variante son internos: nunca se los muestres al cliente.\n` +
    `- Para vender: repetile al cliente qué lleva (producto, variante y cantidad) y el total, preguntale su ` +
    `nombre si no lo sabés, y esperá que confirme por texto. Recién ahí llamá crear_pedido con los ids de ` +
    `variante de la búsqueda.\n` +
    `- El link de pago mandalo tal cual te lo devuelve crear_pedido, sin acortarlo ni cambiarlo, y avisale ` +
    `hasta qué hora vale.\n` +
    `- La entrega, el envío y los retiros los coordina ${titular} directamente: no prometas plazos ni costos.`
  );
}

/** Cómo cobra este comercio y qué pedidos tiene en curso esta conversación. */
export function bloquePedidos(agent: Agent, mpConectado: boolean, pedidos: VentaConItems[], ahora: Date = new Date()): string {
  const titular = agent.nombreTitular || 'el negocio';
  const cobro = mpConectado
    ? `Cobro: con link de pago de Mercado Pago (crear_pedido lo genera y vale 30 minutos). Si el cliente ` +
      `prefiere transferencia o efectivo, creá el pedido con medioPago "manual" y ${titular} coordina el pago.`
    : `Cobro: ${titular} no cobra con link por ahora. Los pedidos quedan anotados (crear_pedido con medioPago ` +
      `"manual") y ${titular} se comunica para coordinar el pago y la entrega.`;
  const pendientes = pedidos.filter((pedido) => estadoVisible(pedido, ahora) === 'pendiente_pago');
  if (pendientes.length === 0) return cobro;
  return (
    `${cobro}\nPedidos sin pagar de este cliente (como mucho ${MAX_PEDIDOS_PENDIENTES} a la vez; consultá el ` +
    `detalle con consultar_pedido): ${pendientes.map((pedido) => detalleDeRenglones(pedido.items)).join(' | ')}.`
  );
}

// h23: "17:42" y no "05:42 p. m.", que es lo que da es-AR por defecto.
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

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
    `${base} Queda reservado hasta el ${FECHA_HORA.format(venta.reservaVenceAt)}. ${titular} se va a ` +
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
        `Pedido del ${FECHA_HORA.format(pedido.createdAt)}: ${detalleDeRenglones(pedido.items)}, total ` +
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
        `los sabés: nunca los inventes, decile que eso lo consulte directamente con ${titular}.\n`) +
    `- Saludos, gracias y despedidas no son otro tema: respondelos normal y breve.`
  );
}

export function reglasDeEstiloVentas(): string {
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Contestá en una o dos frases cortas. Nada de markdown, viñetas, títulos ni listas numeradas.\n' +
    `- Nunca muestres más de ${MAX_PRODUCTOS_POR_MENSAJE} productos en un mismo mensaje, aunque la búsqueda ` +
    'devuelva más: elegí los que mejor encajan con lo que pidió.\n' +
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
