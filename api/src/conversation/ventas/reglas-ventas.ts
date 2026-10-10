/**
 * Bloques del system prompt del asistente de ventas que viven en código y no
 * en el prompt generado, por lo mismo que reglasDeAgenda/reglasDeAlcance:
 * aplican a todo agente de ventas ya creado sin regenerarlo. También el
 * formato de los resultados de búsqueda que vuelven al modelo.
 *
 * Todo acá es puro (sin base ni red), para poder testearlo directo.
 */
import type { ProductoEncontrado } from '../../comercio/busqueda.service.js';
import type { CategoriaPanorama, ProductoPanorama, ResultadoCatalogo } from '../../comercio/sugerencias.rules.js';
import type { ListadoVentas, ResumenVentas } from '../../comercio/historico.service.js';
import { formatearCentavos } from '../../comercio/catalogo.rules.js';
import { leerConfigDatosCliente, reglaDeDatosCliente } from '../../comercio/datos-cliente.rules.js';
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
  const datos = leerConfigDatosCliente(agent);
  const reglaDatos = reglaDeDatosCliente(datos, titular);
  return (
    `Reglas de venta de ${titular} (no las rompas):\n` +
    `- Sos ${agent.nombreBot}, el asistente de ventas de ${titular}. Saludás y decís tu nombre sólo en tu ` +
    `primer mensaje de la conversación; después seguís la charla directo, sin "hola" ni volver a presentarte.\n` +
    `- Todo lo que digas de un producto —si existe, su precio, sus variantes y si hay stock— sale de ` +
    `buscar_productos (o del listado de ver_catalogo) en este mismo mensaje. Nunca lo supongas, lo recuerdes de ` +
    `antes ni lo inventes. El listado trae sólo el precio "desde": para variantes y stock, buscá el producto.\n` +
    `- Si el cliente pregunta en general qué tenés, qué le ofrecés o te pide la lista de productos, llamá ` +
    `ver_catalogo en vez de preguntarle qué busca. Si te devuelve categorías y el cliente elige una, volvé a ` +
    `llamarla con esa categoría.\n` +
    `- Informá los precios exactamente como los devuelve la búsqueda. Nunca redondees, hagas descuentos, ` +
    `promociones, cuotas ni cálculos de envío.\n` +
    `- Si una variante está "sin stock", decilo claro y ofrecé otra variante o producto con stock de los ` +
    `que devolvió la búsqueda. Nunca prometas cuándo vuelve a entrar.\n` +
    `- Si la búsqueda no encuentra lo que pide, decile que no lo tenés. No ofrezcas productos que no ` +
    `aparecieron en los resultados.\n` +
    `- Si el cliente necesita algo del negocio que vos no sabés (un producto que no está, ` +
    `${datos.haceEnvios ? 'costos o plazos de envío' : 'envíos'}, formas de pago, un reclamo), avisale al dueño con derivar_consulta y decile que ${titular} le responde por este chat.\n` +
    `- Los ids de variante son internos: nunca se los muestres al cliente.\n` +
    `- Para vender: cuando el cliente elige un producto, decile en una frase qué le anotás (producto, variante, ` +
    `cantidad y precio) y preguntale "${cierre}". No le pidas que confirme el pedido ni le repitas el resumen ` +
    `para que diga que sí.\n` +
    `- Si quiere algo más, buscalo y volvé a hacerle la misma pregunta. Cuando te diga que no ("no", "nada más", ` +
    `"eso es todo"), llamá crear_pedido con todo lo que eligió en esta charla y ${entrega}. Si no sabés su ` +
    `nombre, preguntáselo en ese momento, antes de crear el pedido.\n` +
    `- El link de pago mandalo tal cual te lo devuelve crear_pedido, sin acortarlo ni cambiarlo, y avisale ` +
    `hasta qué hora vale.\n` +
    (reglaDatos ? `${reglaDatos}\n` : '') +
    `- La entrega, el envío y los retiros los coordina ${titular} directamente: no prometas plazos ni costos.`
  );
}

export { YA_TE_PRESENTASTE } from '../graph/saludo.js';

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
    `Total ${formatearCentavos(venta.totalCentavos)}.` +
    (venta.entrega === 'envio'
      ? ` Es con envío: el costo y el plazo los coordina ${titular}.`
      : venta.entrega === 'retiro'
        ? ` Lo retira: ${titular} le confirma dónde y cuándo.`
        : '');
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
      : `- Los datos de ${titular} que no salen del catálogo —dirección, horarios, formas de pago, ` +
        `${agent.haceEnvios ? 'costos y plazos de envío' : 'envíos'}— no ` +
        `los sabés: nunca los inventes; avisale al dueño con derivar_consulta y decile al cliente que ${titular} ` +
        `le responde.\n`) +
    `- Saludos, gracias y despedidas no son otro tema: respondelos breve, sin volver a presentarte si ya lo hiciste.`
  );
}

export function reglasDeEstiloVentas(): string {
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Contestá en una o dos frases cortas. Nada de markdown, viñetas, títulos ni listas numeradas.\n' +
    `- Nunca muestres más de ${MAX_PRODUCTOS_POR_MENSAJE} productos en un mismo mensaje, aunque la búsqueda ` +
    'devuelva más: elegí los que mejor encajan con lo que pidió.\n' +
    '- La única excepción es lo que devuelve ver_catalogo: ahí sí mostrá la lista entera que te da, una línea ' +
    'por producto o categoría empezando con un guion, sin negritas ni numerar, y una frase corta antes y otra ' +
    'después.\n' +
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
    '. No lo ves entero: buscá con buscar_productos cada vez que hablen de un producto, y usá ver_catalogo ' +
    'cuando pregunten en general qué tenés.'
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

function lineaDeProducto(producto: ProductoPanorama): string {
  const precio = formatearCentavos(producto.precioDesdeCentavos);
  return `- ${JSON.stringify(producto.nombre)}: ${producto.variosPrecios ? `desde ${precio}` : precio}`;
}

function lineaDeCategoria(categoria: CategoriaPanorama): string {
  return `- ${JSON.stringify(categoria.nombre)} (${categoria.cantidad} ${categoria.cantidad === 1 ? 'producto' : 'productos'})`;
}

/** Hay otras categorías además de las sugeridas. */
function otrasCategorias(restantes: number): string {
  return restantes > 0
    ? `\nHay ${restantes} ${restantes === 1 ? 'categoría más' : 'categorías más'}: decile que también tenés otras ` +
        'por si ninguna de estas le interesa, sin nombrarlas.'
    : '';
}

/**
 * Resultado de ver_catalogo. Los nombres del dueño van con `JSON.stringify`
 * como en formatearResultados; el modelo los muestra sin las comillas.
 */
export function formatearCatalogo(resultado: ResultadoCatalogo): string {
  switch (resultado.tipo) {
    case 'vacio':
      return (
        'Ahora no hay ningún producto con stock para ofrecer. Decíselo al cliente en una frase y preguntale si ' +
        'busca algo puntual.'
      );
    case 'listado': {
      const de = resultado.categoria ? ` de ${JSON.stringify(resultado.categoria)}` : '';
      const resto =
        resultado.restantes > 0
          ? `\nEstos son ${resultado.productos.length} de ${resultado.productos.length + resultado.restantes}, ` +
            'los que más le pueden interesar. Decile que tenés más y que, si ninguno le interesa, te cuente qué busca.'
          : '';
      return (
        `Productos con stock${de} (mostrale la lista entera, en este orden, con el precio tal cual; "desde" ` +
        `significa que hay variantes con distinto precio):\n${resultado.productos.map(lineaDeProducto).join('\n')}${resto}`
      );
    }
    case 'categorias':
      return (
        `El catálogo tiene ${resultado.totalProductos} productos con stock, demasiados para listarlos. Sugerile ` +
        `estas categorías, en este orden (las primeras son las que más le pueden interesar), y preguntale cuál ` +
        `quiere ver:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}\n` +
        'Cuando elija una, llamá ver_catalogo con esa categoría.'
      );
    case 'categoria_sin_productos':
      return (
        `No hay productos con stock en la categoría ${JSON.stringify(resultado.categoria)}. Decíselo y sugerile ` +
        `estas, en este orden:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}`
      );
  }
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
