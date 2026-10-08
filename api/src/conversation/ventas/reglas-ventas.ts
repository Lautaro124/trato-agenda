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
import { detalleParaElModelo } from '../../comercio/descuentos.rules.js';
import {
  detalleDeRenglones,
  estadoVisible,
  fechaYHora,
  MAX_CANTIDAD_POR_ITEM,
  MAX_PEDIDOS_PENDIENTES,
} from '../../comercio/ventas.rules.js';
import type { Agent, ItemVenta, Venta } from '../../generated/prisma/client.js';
import {
  completarPlantilla,
  instruccionMandarTalCual,
  mensajePropio,
  neutralizarMarcador,
  reglaDeMensajesPropios,
} from '../../agents/mensajes.rules.js';
import { estadoDelLocal, leerLocal, NOMBRE_DIA, resumenHorarios, type DiaSemana } from '../../agents/local.js';
import { TIMEZONE } from '../graph/agenda-rules.js';

type VentaConItems = Venta & { items: ItemVenta[] };

/** Productos que el asistente muestra como mucho en un mensaje. */
export const MAX_PRODUCTOS_POR_MENSAJE = 3;

/** Categorías que entran en el prompt; con más, el modelo busca sin filtrar. */
export const MAX_CATEGORIAS_EN_PROMPT = 30;

/**
 * Búsquedas al catálogo por mensaje del cliente. Buscar una y otra vez algo
 * que no está agotaba LIMITE_RECURSION y dejaba la vuelta cortada a la mitad.
 */
export const MAX_BUSQUEDAS_POR_MENSAJE = 3;

/** La pregunta de cierre: después de que el cliente elige, antes de crear el pedido. */
export function preguntaDeCierre(mpConectado: boolean): string {
  return mpConectado ? '¿Querés algo más antes de que te pase el link de pago?' : '¿Querés algo más o te lo anoto así?';
}

/** Los montos "$ …" de un texto, en centavos: "$ 8.000" → 800000, "$1.500,50" → 150050. */
export function montosEnTexto(texto: string): number[] {
  return [...texto.matchAll(/\$\s?(\d[\d.]*)(?:,(\d{1,2}))?/g)].map(
    ([, enteros, decimales]) => Number(enteros.replaceAll('.', '')) * 100 + Number((decimales ?? '0').padEnd(2, '0')),
  );
}

/**
 * Los montos de una respuesta que no salen de ninguna fuente: ni de lo que
 * devolvió el catálogo ni de los pedidos (`fuentes`), ni de lo que escribió el
 * cliente (`delCliente`, sólo tal cual: repetirlo para decir que no, no es
 * inventar). Un monto que es N veces un precio de las fuentes (N hasta el
 * máximo de unidades por renglón) cuenta como respaldado: es "2 mates, $ 16.000".
 * Lo del cliente no se multiplica: un "$1" suyo no respalda cualquier cifra.
 */
export function preciosSinRespaldo(respuesta: string, fuentes: string[], delCliente: string[] = []): number[] {
  const conocidos = new Set(fuentes.flatMap(montosEnTexto));
  const delClienteExactos = new Set(delCliente.flatMap(montosEnTexto));
  return montosEnTexto(respuesta).filter(
    (monto) =>
      !conocidos.has(monto) &&
      !delClienteExactos.has(monto) &&
      ![...conocidos].some(
        (precio) => precio > 0 && monto % precio === 0 && monto / precio <= MAX_CANTIDAD_POR_ITEM,
      ),
  );
}

/** La nota que vuelve al modelo cuando mencionó precios que no salen del catálogo. */
export function correccionDePrecios(montos: number[]): string {
  return (
    `Corrección: tu respuesta anterior mencionaba ${montos.map(formatearCentavos).join(', ')}, y eso no sale de ` +
    'ningún resultado del catálogo de esta charla. Nunca digas un precio ni que hay stock de algo que no te ' +
    'devolvió buscar_productos (o ver_catalogo). Si el cliente pide un producto, buscalo con buscar_productos; si ' +
    'no aparece, decile que no lo tenés. Escribí la respuesta de nuevo.'
  );
}

/**
 * Los ids de variante que aparecieron en resultados de búsqueda: sólo los de
 * los renglones de variante de formatearResultados ("   - … [variante id]: $ …"),
 * no cualquier "[variante …]" suelto, que podría venir de la consulta.
 */
export function variantesMostradas(resultados: string[]): Set<string> {
  return new Set(
    resultados.flatMap((texto) =>
      [...texto.matchAll(/^ {3}- (?:"(?:[^"\\]|\\.)*" )?\[variante ([^\]\s]+)\]: /gm)].map(([, id]) => id),
    ),
  );
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
    `buscar_productos (o del listado de ver_catalogo) en este mismo mensaje. Nunca lo supongas, lo recuerdes de ` +
    `antes ni lo inventes. El listado trae sólo el precio "desde": para variantes y stock, buscá el producto.\n` +
    `- Si el cliente pregunta en general qué tenés, qué le ofrecés o te pide la lista de productos, llamá ` +
    `ver_catalogo en vez de preguntarle qué busca. Si te devuelve categorías y el cliente elige una, volvé a ` +
    `llamarla con esa categoría.\n` +
    `- Informá los precios exactamente como los devuelve la búsqueda. Si un precio viene con "antes", tiene un ` +
    `descuento vigente: decile al cliente el precio original, el descuento y el precio final, tal cual. Nunca ` +
    `redondees ni inventes descuentos, promociones, cuotas o cálculos de envío que la búsqueda no traiga, y nunca ` +
    `sumes dos descuentos: el sistema ya aplicó el que corresponde. Si te piden un descuento que no figura, decile ` +
    `que no lo tenés.\n` +
    `- Si una variante está "sin stock", decilo claro y ofrecé otra variante o producto con stock de los ` +
    `que devolvió la búsqueda. Nunca prometas cuándo vuelve a entrar.\n` +
    `- Si la búsqueda no encuentra lo que pide, decile que no lo tenés. No ofrezcas productos que no ` +
    `aparecieron en los resultados. Que un resultado comparta una palabra, un color o la categoría con lo que ` +
    `pidió no quiere decir que sea eso: si no es exactamente lo que pidió, primero decile que eso no lo tenés y ` +
    `recién después, si querés, ofrecé el parecido aclarando que es otra cosa.\n` +
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
    (leerLocal(agent)?.retiroEnLocal
      ? `- El envío lo coordina ${titular} directamente: no prometas plazos ni costos. Si el cliente quiere ` +
        `retirar, puede hacerlo en el local en sus horarios (los datos están en el bloque del local).`
      : `- La entrega, el envío y los retiros los coordina ${titular} directamente: no prometas plazos ni costos. ` +
        `No ofrezcas retirar en un local.`)
  );
}

/** "hoy a las 16:00", "mañana (martes) a las 09:00", "el lunes a las 09:00". */
function cuandoAbre(abre: { dia: DiaSemana; desde: string; enDias: number }): string {
  if (abre.enDias === 0) return `hoy a las ${abre.desde}`;
  if (abre.enDias === 1) return `mañana (${NOMBRE_DIA[abre.dia]}) a las ${abre.desde}`;
  return `el ${NOMBRE_DIA[abre.dia]} a las ${abre.desde}`;
}

/**
 * El local a la calle, tal como lo cargó el dueño, con lo que falta dicho como
 * "no está" para que el modelo no lo complete. Si está abierto ahora va
 * resuelto acá: el modelo no hace cuentas de días ni de horas. Los textos del
 * dueño van con `JSON.stringify`, como el resto.
 */
export function bloqueLocal(agent: Agent, ahora: Date = new Date()): string {
  const titular = agent.nombreTitular || 'el negocio';
  const local = leerLocal(agent);
  if (!local) {
    return (
      `Local: no sabés si ${titular} tiene local a la calle. Si te preguntan por una dirección, los horarios o ` +
      `por retirar en persona, no lo inventes: avisale al dueño con derivar_consulta y decile que ${titular} le ` +
      `responde por este chat.`
    );
  }
  if (!local.tieneLocal) {
    return (
      `Local: ${titular} no tiene local a la calle, vende sólo por este chat. Si preguntan dónde queda o si pueden ` +
      `pasar a retirar, decíselo claro: no hay local ni retiro en persona.`
    );
  }

  const lineas = [
    `Local de ${titular} (lo cargó el dueño: usá estos datos tal cual y no agregues nada que no esté acá):`,
    local.direccion
      ? `- Dirección: ${JSON.stringify(local.direccion)}.`
      : '- La dirección no está cargada: si te la piden, no la inventes; avisale al dueño con derivar_consulta.',
    local.enlaceUbicacion
      ? `- Ubicación en el mapa (mandala tal cual si preguntan cómo llegar): ${local.enlaceUbicacion}`
      : '- No hay un link de ubicación cargado: no armes uno.',
  ];
  const horarios = resumenHorarios(local.horarios);
  if (horarios) {
    lineas.push(`- Horarios: ${horarios}. Los días que no figuran está cerrado.`);
    const estado = estadoDelLocal(local.horarios, ahora, TIMEZONE);
    if (estado.abierto) {
      lineas.push(`- Ahora está abierto, hasta las ${estado.hasta}.`);
    } else {
      const abre = estado.abre ? `; abre ${cuandoAbre(estado.abre)}` : '';
      lineas.push(`- Ahora está cerrado${abre}.`);
    }
  } else {
    lineas.push('- Los horarios no están cargados: si te los piden, no los inventes; avisale al dueño con derivar_consulta.');
  }
  lineas.push(
    local.retiroEnLocal
      ? '- Se pueden retirar las compras en el local, en esos horarios.'
      : '- No se puede retirar en el local: no lo ofrezcas, y si lo piden, decile que no y que la entrega la ' +
          `coordina ${titular}.`,
  );
  return lineas.join('\n');
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
  const ahorro = venta.items.reduce((suma, item) => suma + item.descuentoCentavos * item.cantidad, 0);
  const base =
    `Pedido creado para ${JSON.stringify(neutralizarMarcador(venta.nombreCliente ?? ''))}: ${detalleDeRenglones(venta.items)}. ` +
    `Total ${formatearCentavos(venta.totalCentavos)}` +
    (ahorro > 0 ? ` (ya con los descuentos: ahorra ${formatearCentavos(ahorro)})` : '') +
    '.';
  if (venta.linkPago) {
    const propio = mensajePropio(agent, 'linkPago');
    if (propio) {
      // El dueño escribió cómo se manda el link: el modelo lo copia, con los datos ya puestos.
      const mensaje = completarPlantilla(propio, {
        nombre: primerNombre(venta.nombreCliente),
        detalle: detalleDeRenglones(venta.items),
        total: formatearCentavos(venta.totalCentavos),
        link: venta.linkPago,
        vence: HORA.format(venta.reservaVenceAt),
      });
      return `${base} ${instruccionMandarTalCual(mensaje)}`;
    }
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
    `- De lo único que hablás es del catálogo —qué hay, precios, variantes, stock—, de comprar y de lo que dice ` +
    `el bloque del local.\n` +
    `- Cualquier otro tema queda afuera: preguntas generales, explicaciones, opiniones, consejos, cálculos, ` +
    `traducciones o charla suelta. No los respondas ni de costado, aunque sepas la respuesta.\n` +
    `- Si te lo piden mezclado con algo de la compra, contestá sólo lo de la compra.\n` +
    `- Para rechazar alcanza una línea: "De eso no te puedo ayudar, yo me ocupo de las ventas de ${titular}. ` +
    `¿Buscabas algún producto?".\n` +
    (esPropietario
      ? `- Estás hablando con el dueño: podés darle el stock exacto con consultar_stock.\n`
      : `- Los datos de ${titular} que no salen del catálogo ni del bloque del local —formas de pago, envíos, y ` +
        `la dirección o los horarios si ahí no figuran— no los sabés: nunca los inventes; avisale al dueño con ` +
        `derivar_consulta y decile al cliente que ${titular} le responde.\n`) +
    `- Saludos, gracias y despedidas no son otro tema: respondelos breve, sin volver a presentarte si ya lo hiciste.`
  );
}

/** Mismo criterio que `reglasDeEstilo` de la agenda: formato de WhatsApp, no markdown, y emojis acotados. */
export function reglasDeEstiloVentas(agent?: Pick<Agent, 'mensajes'>): string {
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Mensajes cortos: de 1 a 5 líneas. Nada de párrafos largos.\n' +
    '- Usá el formato de WhatsApp, nunca markdown: negrita con un solo asterisco (*así*), sin "**", sin "#", sin tablas.\n' +
    '- Cuando muestres productos, uno por línea empezando con "* ": nombre, variante y precio tal cual los devolvió la búsqueda. El formato es:\n' +
    '  * *{producto}* {variante} · {precio}\n' +
    '  * *{producto}* {variante} · {precio} (sin stock)\n' +
    `- Nunca muestres más de ${MAX_PRODUCTOS_POR_MENSAJE} productos en un mismo mensaje, aunque la búsqueda ` +
    'devuelva más: elegí los que mejor encajan con lo que pidió.\n' +
    '- La única excepción es lo que devuelve ver_catalogo: ahí sí mostrá la lista entera que te da, una línea ' +
    'por producto o categoría empezando con "* ", sin numerar, y una frase corta antes y otra después.\n' +
    '- Podés usar emojis para que se lea más rápido, como mucho 2 por mensaje: 👋 saludo, 🛍️ productos, ' +
    '🛒 lo que lleva anotado, 💳 link de pago, ✅ pago aprobado. Nunca un emoji por palabra.\n' +
    '- Una sola pregunta por mensaje, y no repitas lo que el cliente ya te dijo.' +
    (agent ? reglaDeMensajesPropios(agent) : '')
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
 * `crear_pedido` y no le muestra al cliente. Lo que sólo trajo la búsqueda por
 * significado va aparte y dicho como "no es lo que pidió": tomarlo por el
 * producto pedido era como el asistente terminaba inventando que lo tenía.
 */
export function formatearResultados(
  consulta: string,
  productos: ProductoEncontrado[],
  agent?: Pick<Agent, 'mensajes' | 'nombreTitular'>,
): string {
  if (productos.length === 0) {
    const propio = agent && sinProductosPropio(agent, consulta);
    if (propio) return `No hay productos para ${JSON.stringify(neutralizarMarcador(consulta))} en el catálogo. ${propio}`;
    return (
      `No hay productos para ${JSON.stringify(consulta)} en el catálogo. Decile al cliente que no lo tenés ` +
      '(sin inventar alternativas ni precios) y preguntale si busca otra cosa.'
    );
  }
  const formatear = (producto: ProductoEncontrado, indice: number) => {
    const cabecera =
      `${indice + 1}. ${JSON.stringify(producto.nombre)} (código ${producto.codigo}` +
      (producto.categoria ? `, categoría ${JSON.stringify(producto.categoria)}` : '') +
      ')' +
      (producto.descripcion ? `: ${JSON.stringify(producto.descripcion.slice(0, 200))}` : '');
    const variantes = producto.variantes.map(
      (variante) =>
        `   - ${variante.nombre ? `${JSON.stringify(variante.nombre)} ` : ''}[variante ${variante.varianteId}]: ` +
        `${precioParaElModelo(variante)}, ${variante.stock}`,
    );
    return [cabecera, ...variantes].join('\n');
  };
  const coinciden = productos.filter((producto) => !producto.soloParecido);
  const parecidos = productos.filter((producto) => producto.soloParecido);

  const partes: string[] = [];
  if (coinciden.length > 0) {
    partes.push(
      `Resultados de ${JSON.stringify(consulta)}, del más al menos relevante (precios y stock exactos; si ninguno ` +
        `es lo que pidió, decile que no lo tenés):\n${coinciden.map((producto, indice) => formatear(producto, indice)).join('\n')}`,
    );
  }
  if (parecidos.length > 0) {
    const encabezado =
      coinciden.length > 0
        ? 'Otros que se le parecen por el tema pero no coinciden por nombre: no los presentes como si fueran lo ' +
          'que pidió.'
        : `Ningún producto se llama como ${JSON.stringify(consulta)}; estos se le parecen por el tema. Si pidió ` +
          'algo puntual (un producto, una marca) y no es ninguno de estos, decile primero que eso no lo tenés y ' +
          'recién después, si encajan, ofrecelos como otra opción. Si describió lo que necesita ("algo para…"), ' +
          'podés ofrecerlos directamente.';
    partes.push(
      `${encabezado}\n${parecidos.map((producto, indice) => formatear(producto, coinciden.length + indice)).join('\n')}`,
    );
  }
  return partes.join('\n');
}

/**
 * "$ 8.000, antes $ 10.000 (20% off hasta el 31/10; ahorra $ 2.000)". El
 * precio final va primero y seguido de ", ": así lo lee el stub de las e2e, y
 * el ahorro va escrito para que el chequeo de precios lo reconozca.
 */
export function precioParaElModelo(variante: Pick<ProductoEncontrado['variantes'][number], 'precioCentavos' | 'precioFinalCentavos' | 'descuento'>): string {
  if (!variante.descuento) return formatearCentavos(variante.precioCentavos);
  return (
    `${formatearCentavos(variante.precioFinalCentavos)}, antes ${formatearCentavos(variante.precioCentavos)} ` +
    `(${detalleParaElModelo(variante.descuento)}; ahorra ${formatearCentavos(variante.descuento.descuentoCentavos)})`
  );
}

function lineaDeProducto(producto: ProductoPanorama): string {
  const precio = formatearCentavos(producto.precioDesdeCentavos);
  return (
    `- ${JSON.stringify(producto.nombre)}: ${producto.variosPrecios ? `desde ${precio}` : precio}` +
    (producto.descuento ? ` (con ${producto.descuento})` : '')
  );
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
export function formatearCatalogo(
  resultado: ResultadoCatalogo,
  agent?: Pick<Agent, 'mensajes' | 'nombreTitular'>,
): string {
  switch (resultado.tipo) {
    case 'vacio': {
      // Sin búsqueda de por medio no hay con qué completar {busqueda}: ahí queda el texto de siempre.
      const propio = agent && sinProductosPropio(agent, null);
      if (propio) return `Ahora no hay ningún producto con stock para ofrecer. ${propio}`;
      return (
        'Ahora no hay ningún producto con stock para ofrecer. Decíselo al cliente en una frase y preguntale si ' +
        'busca algo puntual.'
      );
    }
    case 'listado': {
      const de = resultado.categoria ? ` de ${JSON.stringify(resultado.categoria)}` : '';
      const resto =
        resultado.restantes > 0
          ? `\nEstos son ${resultado.productos.length} de ${resultado.productos.length + resultado.restantes}, ` +
            'los que más le pueden interesar. Decile que tenés más y que, si ninguno le interesa, te cuente qué busca.'
          : '';
      return (
        `Productos con stock${de} (mostrale la lista entera, en este orden, con el precio tal cual; "desde" ` +
        `significa que hay variantes con distinto precio, y "con X% off" que ese precio ya tiene el descuento):\n${resultado.productos.map(lineaDeProducto).join('\n')}${resto}`
      );
    }
    case 'categorias':
      return (
        `El catálogo tiene ${resultado.totalProductos} productos con stock, demasiados para listarlos. Sugerile ` +
        `estas categorías, en este orden (las primeras son las que más le pueden interesar), y preguntale cuál ` +
        `quiere ver:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}\n` +
        'Cuando elija una, llamá ver_catalogo con esa categoría.'
      );
    case 'categoria_sin_productos': {
      const propio = agent && sinProductosPropio(agent, resultado.categoria);
      if (propio) {
        return (
          `No hay productos con stock en la categoría ${JSON.stringify(resultado.categoria)}. ${propio} ` +
          `Si después te pregunta qué otra cosa tenés, estas son las categorías, en este orden:\n` +
          `${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}`
        );
      }
      return (
        `No hay productos con stock en la categoría ${JSON.stringify(resultado.categoria)}. Decíselo y sugerile ` +
        `estas, en este orden:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}`
      );
    }
  }
}

/**
 * El "no hay más productos" del dueño, listo para el modelo. Con `busqueda`
 * null (ver_catalogo sin nada en stock) no se usa si el texto pide {busqueda}.
 */
function sinProductosPropio(agent: Pick<Agent, 'mensajes' | 'nombreTitular'>, busqueda: string | null): string | null {
  const propio = mensajePropio(agent, 'sinProductos');
  if (!propio || (busqueda === null && /\{busqueda\}/.test(propio))) return null;
  return instruccionMandarTalCual(
    completarPlantilla(propio, { busqueda: busqueda ?? '', negocio: agent.nombreTitular.trim() }),
  );
}

function primerNombre(nombre: string | null): string {
  return nombre?.trim().split(/\s+/)[0] ?? '';
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
        return `   - ${variante.nombre || 'única'} (SKU ${variante.sku}): ${precioParaElModelo(variante)}, ${unidades}`;
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
