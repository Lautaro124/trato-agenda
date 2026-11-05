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
import type { CotizacionFormasDePago } from '../../comercio/ventas.service.js';
import { formatearMonto, monedaDe, type Moneda } from '../../comercio/catalogo.rules.js';
import {
  describirCuotas,
  SIN_CONDICIONES,
  valorDeCuota,
  type CondicionesPago,
} from '../../comercio/condiciones-pago.rules.js';
import { leerConfigDatosCliente, reglaDeDatosCliente, type EtapaDeCompra } from '../../comercio/datos-cliente.rules.js';
import {
  detalleParaElModelo,
  diaCorto,
  type DescuentosVigentes,
  type ProductoConDescuento,
  type PromocionVigente,
} from '../../comercio/descuentos.rules.js';
import { describirPreguntas } from '../../comercio/preguntas-producto.rules.js';
import {
  detalleDeRenglones,
  estadoVisible,
  fechaYHora,
  MAX_CANTIDAD_POR_ITEM,
  MAX_PEDIDOS_PENDIENTES,
} from '../../comercio/ventas.rules.js';
import type { BaseMessage } from '@langchain/core/messages';
import type { Agent, ItemVenta, Venta } from '../../generated/prisma/client.js';
import {
  completarPlantilla,
  instruccionMandarTalCual,
  mensajePropio,
  neutralizarMarcador,
  REGLA_MENSAJE_TAL_CUAL,
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

/**
 * Pesos y dólares: el catálogo puede tener productos en las dos monedas. El
 * prefijo es lo único que las distingue, así que el modelo no lo puede cambiar.
 */
export const REGLA_MONEDAS =
  '- Los precios con "US$" son en dólares y los que llevan sólo "$", en pesos: escribilos con el mismo símbolo ' +
  'y nunca los conviertas a la otra moneda. Un pedido no mezcla monedas: si elige productos en pesos y en ' +
  'dólares, son dos pedidos. Un pedido en dólares no lleva link de pago: el pago se coordina por este chat.';

/** La pregunta de cierre: después de que el cliente elige, antes de crear el pedido. */
export function preguntaDeCierre(mpConectado: boolean): string {
  return mpConectado ? '¿Querés algo más antes de que te pase el link de pago?' : '¿Querés algo más o te lo anoto así?';
}

/** Un monto escrito en un texto, con su moneda. */
export type Monto = { moneda: Moneda; centavos: number };

/**
 * Los montos de un texto, en centavos y con su moneda: "$ 8.000" → 800000 en
 * pesos, "$1.500,50" → 150050 en pesos, "US$ 10" (o "U$S 10", "USD 10") → 1000
 * en dólares. El "$ 10" que hay dentro de "US$ 10" no cuenta como pesos.
 */
export function montosEnTexto(texto: string): Monto[] {
  return [...texto.matchAll(/(?:(US\$|U\$S|USD)\s?|\$\s?)(\d[\d.]*)(?:,(\d{1,2}))?/gi)].map(
    ([, dolares, enteros, decimales]) => ({
      moneda: dolares ? 'USD' : 'ARS',
      centavos: Number(enteros.replaceAll('.', '')) * 100 + Number((decimales ?? '0').padEnd(2, '0')),
    }),
  );
}

const claveDeMonto = (monto: Monto) => `${monto.moneda}:${monto.centavos}`;

/**
 * Los montos de una respuesta que no salen de ninguna fuente: ni de lo que
 * devolvió el catálogo ni de los pedidos (`fuentes`), ni de lo que escribió el
 * cliente (`delCliente`, sólo tal cual: repetirlo para decir que no, no es
 * inventar). Un monto que es N veces un precio de las fuentes (N hasta el
 * máximo de unidades por renglón) cuenta como respaldado: es "2 mates, $ 16.000".
 * Lo del cliente no se multiplica: un "$1" suyo no respalda cualquier cifra.
 */
export function preciosSinRespaldo(respuesta: string, fuentes: string[], delCliente: string[] = []): Monto[] {
  const conocidos = fuentes.flatMap(montosEnTexto);
  const claves = new Set(conocidos.map(claveDeMonto));
  const delClienteExactos = new Set(delCliente.flatMap(montosEnTexto).map(claveDeMonto));
  return montosEnTexto(respuesta).filter(
    (monto) =>
      !claves.has(claveDeMonto(monto)) &&
      !delClienteExactos.has(claveDeMonto(monto)) &&
      // N unidades de un precio conocido, siempre de la misma moneda: US$ 20 no sale de $ 10.
      !conocidos.some(
        (precio) =>
          precio.moneda === monto.moneda &&
          precio.centavos > 0 &&
          monto.centavos % precio.centavos === 0 &&
          monto.centavos / precio.centavos <= MAX_CANTIDAD_POR_ITEM,
      ),
  );
}

/** La nota que vuelve al modelo cuando mencionó precios que no salen del catálogo. */
export function correccionDePrecios(montos: Monto[]): string {
  return (
    `Corrección: tu respuesta anterior mencionaba ${montos.map((monto) => formatearMonto(monto.centavos, monto.moneda)).join(', ')}, ` +
    'y eso no sale de ningún resultado del catálogo de esta charla. Nunca digas un precio ni que hay stock de algo ' +
    'que no te devolvió buscar_productos (o ver_catalogo), y escribí cada precio en la moneda en que aparece ("$" ' +
    'son pesos, "US$" son dólares). Si el cliente pide un producto, buscalo con buscar_productos; si no aparece, ' +
    'decile que no lo tenés. Escribí la respuesta de nuevo.'
  );
}

/** Para comparar nombres: sin mayúsculas, tildes, asteriscos de negrita ni espacios de más. */
function normalizarNombre(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una foto que salió con su nombre y precio al pie (las del listado de ver_catalogo). */
export type FotoConLeyenda = { nombre: string; leyenda: string };

/**
 * Las líneas de la respuesta que repiten un producto que ya le llegó en foto
 * con su nombre y precio al pie: nombran el producto y llevan el mismo precio
 * que su leyenda. Pedir las dos cosas evita confundir "Mate" (en foto) con
 * "Mate de calabaza" (otro precio, sin foto).
 */
export function lineasQueRepitenFotos(respuesta: string, fotos: FotoConLeyenda[]): string[] {
  const conPrecio = fotos.map((foto) => ({
    nombre: normalizarNombre(foto.nombre),
    precios: new Set(montosEnTexto(foto.leyenda).map(claveDeMonto)),
  }));
  return respuesta.split('\n').filter((linea) => {
    const normalizada = normalizarNombre(linea);
    const montos = montosEnTexto(linea).map(claveDeMonto);
    return conPrecio.some(
      (foto) => foto.nombre !== '' && normalizada.includes(foto.nombre) && montos.some((monto) => foto.precios.has(monto)),
    );
  });
}

/** La nota que vuelve al modelo cuando repitió en el texto los productos que ya le llegaron en foto. */
export function correccionDeListaRepetida(): string {
  return (
    'Corrección: tu respuesta anterior repetía productos con su precio, y esos ya le llegaron al cliente en foto ' +
    'con el nombre y el precio al pie. No los vuelvas a listar: nombrale sólo los que no le llegaron en foto, si ' +
    'hay, y preguntale en una frase cuál le interesa. Escribí la respuesta de nuevo.'
  );
}

/**
 * La respuesta sin esas líneas, para cuando el modelo insiste en repetirlas.
 * `null` si no queda nada que decir.
 */
export function sinLineasRepetidas(respuesta: string, repetidas: string[]): string | null {
  const quitar = new Set(repetidas);
  const texto = respuesta
    .split('\n')
    .filter((linea) => !quitar.has(linea))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return texto === '' ? null : texto;
}

/**
 * Los ids de producto que aparecieron en resultados de búsqueda: sólo los de
 * las cabeceras de formatearResultados ('1. "Mate" [producto id] (código …'),
 * no cualquier "[producto …]" suelto, que podría venir de la consulta.
 */
export function productosMostrados(resultados: string[]): Set<string> {
  return new Set(
    resultados.flatMap((texto) =>
      [...texto.matchAll(/^\d+\. "(?:[^"\\]|\\.)*" \[producto ([^\]\s]+)\] \(código /gm)].map(([, id]) => id),
    ),
  );
}

/** Las reglas de venta. */
export function reglasDeVenta(agent: Agent, mpConectado: boolean, etapa: EtapaDeCompra | null = null): string {
  const titular = agent.nombreTitular || 'este negocio';
  const cierre = preguntaDeCierre(mpConectado);
  const entrega = mpConectado ? 'mandale el link de pago' : 'decile que quedó anotado';
  const datos = leerConfigDatosCliente(agent);
  const reglaDatos = reglaDeDatosCliente(datos, etapa);
  return (
    `Reglas de venta de ${titular} (no las rompas):\n` +
    `- Sos ${agent.nombreBot} y atendés las ventas por WhatsApp de ${titular}. Saludás y decís tu nombre sólo en tu ` +
    `primer mensaje de la conversación; después seguís la charla directo, sin "hola" ni volver a presentarte.\n` +
    `${REGLA_VOZ_DE_EQUIPO}\n` +
    `- Todo lo que digas de un producto —si existe, su precio y si hay stock— sale de ` +
    `buscar_productos (o del listado de ver_catalogo) en este mismo mensaje. Nunca lo supongas, lo recuerdes de ` +
    `antes ni lo inventes. Para el stock, buscá el producto.\n` +
    `- La descripción de un producto es para que vos entiendas qué es: no se la recites al cliente. Contale lo ` +
    `que le sirve para lo que preguntó, con tus palabras.\n` +
    `- Si el cliente pregunta en general qué tenés, qué le ofrecés o te pide la lista de productos, llamá ` +
    `ver_catalogo en vez de preguntarle qué busca. Si te devuelve categorías y el cliente elige una, volvé a ` +
    `llamarla con esa categoría.\n` +
    `- Informá los precios exactamente como los devuelve la búsqueda. Si un precio viene con "antes", tiene un ` +
    `descuento vigente: decile al cliente el precio original, el descuento y el precio final, tal cual. Nunca ` +
    `redondees ni inventes descuentos, promociones, cuotas o cálculos de envío que la búsqueda no traiga, y nunca ` +
    `sumes dos descuentos: el sistema ya aplicó el que corresponde.\n` +
    `${REGLA_MONEDAS}\n` +
    `- Si el cliente pregunta por descuentos, promociones u ofertas, o te dice que sí cuando le ofreciste ` +
    `pasárselos, llamá ver_descuentos y pasale todos los que te devuelve. Si pide un descuento que no está ahí, ` +
    `decile que no lo tenés.\n` +
    `- Si un producto está "sin stock", decilo claro y ofrecé otro producto con stock de los ` +
    `que devolvió la búsqueda. Nunca prometas cuándo vuelve a entrar.\n` +
    `- Si la búsqueda no encuentra lo que pide, decile que no lo tenés. No ofrezcas productos que no ` +
    `aparecieron en los resultados. Que un resultado comparta una palabra, un color o la categoría con lo que ` +
    `pidió no quiere decir que sea eso: si no es exactamente lo que pidió, primero decile que eso no lo tenés y ` +
    `recién después, si querés, ofrecé el parecido aclarando que es otra cosa.\n` +
    `- Si el cliente necesita algo que vos no sabés (un producto que no está, ` +
    `${datos.haceEnvios ? 'costos o plazos de envío' : 'envíos'}, formas de pago, un reclamo), pasáselo al ` +
    `equipo con derivar_consulta y decile que en un rato le escribimos por este chat.\n` +
    `- Los ids de producto son internos: nunca se los muestres al cliente.\n` +
    `${REGLA_FOTOS_PEDIDAS}\n` +
    `${REGLA_FOTOS_SOLAS}\n` +
    `- Para vender: cuando el cliente elige un producto, decile en una frase qué le anotás (producto, ` +
    `cantidad y precio) y preguntale "${cierre}". No le pidas que confirme el pedido ni le repitas el resumen ` +
    `para que diga que sí.\n` +
    `- Si el producto trae "preguntas al pedirlo", hacéselas al cliente (una por mensaje, con sus opciones si las ` +
    `tiene) antes de crear el pedido, y mandá lo que contestó en \`respuestas\`. Las obligatorias no se pueden ` +
    `saltear; las opcionales, si dice que no quiere, no las mandes. Nunca contestes por él ni inventes opciones.\n` +
    `- Si quiere algo más, buscalo y volvé a hacerle la misma pregunta. Cuando te diga que no ("no", "nada más", ` +
    `"eso es todo"), llamá crear_pedido con todo lo que eligió en esta charla y ${entrega}. Si no sabés su ` +
    `nombre, preguntáselo en ese momento, antes de crear el pedido.\n` +
    `- El link de pago mandalo tal cual te lo devuelve crear_pedido, sin acortarlo ni cambiarlo, y avisale ` +
    `hasta qué hora vale.\n` +
    (reglaDatos ? `${reglaDatos}\n` : '') +
    (leerLocal(agent)?.retiroEnLocal
      ? `- El envío lo coordinamos nosotros por este chat: no prometas plazos ni costos. Si el cliente quiere ` +
        `retirar, puede hacerlo en el local en sus horarios (los datos están en el bloque del local).`
      : `- La entrega y el envío los coordinamos nosotros por este chat: no prometas plazos ni costos. ` +
        `No ofrezcas retirar en un local.`)
  );
}

/**
 * Que hable como alguien del negocio y no como un intermediario: "X hace
 * envíos" o "X te responde" sonaba a call center tercerizado.
 */
export const REGLA_VOZ_DE_EQUIPO =
  '- Sos parte del equipo del negocio: hablá en primera persona del plural ("tenemos", "te lo mandamos", ' +
  '"hacemos envíos", "te escribimos por acá"). Nunca hables del negocio en tercera persona ni digas "el dueño", ' +
  '"el negocio te responde" o su nombre como si fuera otro.';

/**
 * Un producto se elige mirando: las fotos de lo que se le muestra van solas,
 * sin que las pida. El tope por mensaje y las repetidas
 * las corta la validación.
 */
export const REGLA_FOTOS_SOLAS =
  '- Las fotos mandalas sin esperar a que te las pidan: cuando le muestres productos de una búsqueda que dicen ' +
  '"tiene foto", mandale con enviar_imagen_producto la de cada uno que le nombrás (hasta 3), salvo las que ya le ' +
  'llegaron en esta charla. Las del listado de ver_catalogo ya le llegaron solas. No las describas: seguí la charla.';

/** Pedir una foto y que conteste "no hay" cuando la búsqueda decía que sí. */
export const REGLA_FOTOS_PEDIDAS =
  '- Si el cliente pide ver un producto o te pide una foto, y la búsqueda lo marca "tiene foto", ' +
  'mandásela con enviar_imagen_producto. Nunca le digas que no hay foto de algo que la ' +
  'búsqueda marca con foto. Si te pide "el tercero", "ese" o "el de 190", es el de la lista que le pasaste. ' +
  'Si ya vio el producto y pide más fotos o más detalles, y la búsqueda marca "fotos de detalle", mandáselas ' +
  'con enviar_imagen_producto y detalles: true; si no tiene, contale cómo es con lo que dice el catálogo.';

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
      `por retirar en persona, no lo inventes: pasáselo al equipo con derivar_consulta y decile que en un rato le ` +
      `escribimos por este chat.`
    );
  }
  if (!local.tieneLocal) {
    return (
      `Local: ${titular} no tiene local a la calle, vende sólo por este chat. Si preguntan dónde queda o si pueden ` +
      `pasar a retirar, decíselo claro: no tenemos local ni retiro en persona.`
    );
  }

  const lineas = [
    `Local de ${titular} (lo cargó el dueño: usá estos datos tal cual y no agregues nada que no esté acá):`,
    local.direccion
      ? `- Dirección: ${JSON.stringify(local.direccion)}.`
      : '- La dirección no está cargada: si te la piden, no la inventes; pasáselo al equipo con derivar_consulta.',
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
    lineas.push('- Los horarios no están cargados: si te los piden, no los inventes; pasáselo al equipo con derivar_consulta.');
  }
  lineas.push(
    local.retiroEnLocal
      ? '- Se pueden retirar las compras en el local, en esos horarios.'
      : '- No se puede retirar en el local: no lo ofrezcas, y si lo piden, decile que no y que la entrega la ' +
          'coordinamos por este chat.',
  );
  return lineas.join('\n');
}

export { YA_TE_PRESENTASTE } from '../graph/saludo.js';

/**
 * Con el cobro manual configurado, anotar un pedido sin link deja el chat en
 * manos del negocio: todo lo que haga falta se pregunta antes.
 */
const ANTES_DEL_COBRO_MANUAL =
  'Mandáselo tal cual y no sigas: desde ahí el chat lo sigue el negocio, que valida el pago. Por eso, antes de ' +
  'anotarlo confirmá todo lo que haga falta (productos, entrega, datos y si quiere algo más).';

const CIERRE_COBRO_MANUAL =
  'Es tu último mensaje en este chat: después lo sigue el negocio. No le hagas preguntas ni le ofrezcas nada más.';

type VentaCobrable = Pick<Venta, 'totalCentavos' | 'moneda' | 'formaPago' | 'nombreCliente'> & { items: ItemVenta[] };

/**
 * Lo que se le manda al cliente al anotar un pedido sin link cuando el
 * comercio configuró el cobro manual, o null si no lo configuró. Los datos del
 * dueño entran por completarPlantilla: una línea, acotados y sin el marcador.
 * Un pedido en dólares o en efectivo no va al alias (está en pesos y es para
 * transferir): ahí el negocio escribe para coordinar.
 */
export function mensajeDeCobroManual(agent: Agent, condiciones: CondicionesPago, venta: VentaCobrable): string | null {
  const cobro = condiciones.cobroManual;
  if (!cobro) return null;
  const datos = {
    nombre: primerNombre(venta.nombreCliente),
    total: formatearMonto(venta.totalCentavos ?? 0, venta.moneda),
    detalle: detalleDeRenglones(venta.items, venta.moneda),
    negocio: agent.nombreTitular || 'El negocio',
  };
  if (cobro.modo === 'otro_canal') return completarPlantilla(cobro.mensaje, datos);
  if (monedaDe(venta.moneda) !== 'ARS' || venta.formaPago === 'efectivo') {
    return completarPlantilla(
      `¡Listo, quedó anotado! {negocio} te escribe por acá para coordinar el pago${venta.formaPago === 'efectivo' ? ' en efectivo' : ''}.`,
      datos,
    );
  }
  return completarPlantilla(
    `Para confirmar tu pedido, transferí {total} al ${/^\d{22}$/.test(cobro.alias) ? 'CBU/CVU' : 'alias'} {alias} ` +
      `(a nombre de {titular}) y mandá el comprobante por acá. {negocio} lo revisa y te confirma.`,
    { ...datos, alias: cobro.alias, titular: cobro.titular },
  );
}

/**
 * Si el pedido dejó el chat para el negocio por el cobro manual, lo que el
 * modelo tiene que mandar (tal cual) y cortar; si no, null.
 */
function cobroManualParaElModelo(
  agent: Agent,
  condiciones: CondicionesPago,
  venta: VentaCobrable & Pick<Venta, 'atencion' | 'motivoDerivacion'>,
): string | null {
  if (venta.atencion !== 'humana' || venta.motivoDerivacion !== 'cobro_manual') return null;
  const mensaje = mensajeDeCobroManual(agent, condiciones, venta);
  return mensaje ? `${instruccionMandarTalCual(mensaje)} ${CIERRE_COBRO_MANUAL}` : null;
}

/** Cómo cobra este comercio y qué pedidos tiene en curso esta conversación. */
export function bloquePedidos(
  agent: Agent,
  mpConectado: boolean,
  pedidos: VentaConItems[],
  ahora: Date = new Date(),
  condiciones: CondicionesPago = SIN_CONDICIONES,
): string {
  const titular = agent.nombreTitular || 'el negocio';
  const manual = condiciones.cobroManual;
  const sinLink = manual
    ? `crear_pedido te devuelve el mensaje con cómo pagar${manual.modo === 'transferencia' ? ' (los datos para transferir)' : ''}. ` +
      ANTES_DEL_COBRO_MANUAL
    : '';
  const cobro = mpConectado
    ? `Cobro: con link de pago de Mercado Pago (crear_pedido lo genera y vale 30 minutos). Si el cliente ` +
      `prefiere transferencia o efectivo, creá el pedido con medioPago "manual" y ` +
      (manual ? sinLink : `decile que le escribimos por acá para coordinar el pago.`)
    : `Cobro: ${titular} no cobra con link por ahora. Los pedidos quedan anotados (crear_pedido con medioPago ` +
      `"manual") ` +
      (manual ? `y ${sinLink}` : `y le escribimos por este chat para coordinar el pago y la entrega.`) +
      (manual ? REGLA_MENSAJE_TAL_CUAL : '');
  const pendientes = pedidos.filter((pedido) => estadoVisible(pedido, ahora) === 'pendiente_pago');
  const pagados = pedidos.filter((pedido) => pedido.estado === 'pagada');
  const lineas = [cobro, reglaDeFormasDePago(condiciones, mpConectado)];
  if (pendientes.length > 0) {
    lineas.push(
      `Pedidos sin pagar de este cliente (como mucho ${MAX_PEDIDOS_PENDIENTES} a la vez; consultá el detalle con ` +
        `consultar_pedido): ${pendientes.map((pedido) => detalleDeRenglones(pedido.items, pedido.moneda)).join(' | ')}.`,
    );
  }
  if (pagados.length > 0) {
    // El aviso de "pago aprobado" sale fuera del grafo: sin esto el modelo no sabría que ya se cobró.
    lineas.push(
      `Pedidos ya pagados de este cliente (el pago está aprobado: si pregunta, decíselo): ` +
        `${pagados.map((pedido) => detalleDeRenglones(pedido.items, pedido.moneda)).join(' | ')}.`,
    );
  }
  return lineas.join('\n');
}

/**
 * Las formas de pago del comercio (LAU-34), sólo números de la base: las
 * cuotas son de cada producto (vienen en la búsqueda) y el descuento en
 * efectivo es de la cuenta.
 */
export function reglaDeFormasDePago(condiciones: CondicionesPago, mpConectado: boolean): string {
  const partes = [
    'cuotas: cada producto tiene las suyas y vienen en la búsqueda ("cuotas: …"); si no dice nada, se vende en un ' +
      'pago. Sólo en pesos' +
      (mpConectado ? ', con el link de Mercado Pago' : ', se coordinan por este chat, sin link') +
      '. Un pedido con varios productos sólo va en las cuotas que tienen todos',
  ];
  if (condiciones.descuentoEfectivoPorcentaje !== null) {
    partes.push(
      `${condiciones.descuentoEfectivoPorcentaje}% de descuento pagando en efectivo (sólo en efectivo: no con ` +
        'transferencia ni con el link, y no se suma a otras promos: se aplica el que más le conviene)',
    );
  } else {
    partes.push('no hay descuento por pagar en efectivo');
  }
  return (
    `Formas de pago del negocio: ${partes.join('; ')}. No ofrezcas otras. Para cuánto sale un pedido en cada una ` +
    '(total y valor de la cuota) llamá ver_formas_de_pago con lo que eligió: nunca hagas la cuenta vos. Al crear el ' +
    'pedido, mandá formaPago ("efectivo" o "cuotas" con `cuotas`) si el cliente eligió una.'
  );
}

/** Con qué empieza el resultado de ver_formas_de_pago cuando hay totales. */
export const ENCABEZADO_FORMAS_DE_PAGO = 'Formas de pago de este pedido';

const SIN_CUOTAS: Record<NonNullable<CotizacionFormasDePago['sinCuotas']>, string> = {
  dolares: '- Es en dólares: no hay cuotas.',
  un_pago: '- Se vende en un pago: no hay cuotas.',
  sin_comun:
    '- Juntos no tienen cuotas en común: este pedido va en un pago. Si quiere cuotas, puede hacer un pedido aparte ' +
    'para lo que se vende en cuotas.',
};

/**
 * Resultado de ver_formas_de_pago. Sin cotización, las condiciones; con ella,
 * los totales escritos para que preciosSinRespaldo los reconozca.
 */
export function formatearFormasDePago(
  condiciones: CondicionesPago,
  mpConectado: boolean,
  cotizacion: CotizacionFormasDePago | null,
): string {
  if (!cotizacion) {
    return (
      `${reglaDeFormasDePago(condiciones, mpConectado)}
Pasale estas condiciones al cliente. Para los montos, ` +
      'volvé a llamar ver_formas_de_pago con los productos que eligió.'
    );
  }
  const monto = (centavos: number) => formatearMonto(centavos, cotizacion.moneda);
  const lineas = [`- En un pago${mpConectado ? ' (link de pago o transferencia)' : ''}: ${monto(cotizacion.contadoCentavos)}`];
  if (cotizacion.efectivoCentavos !== null) {
    lineas.push(
      cotizacion.efectivoCentavos < cotizacion.contadoCentavos
        ? `- En efectivo: ${monto(cotizacion.efectivoCentavos)} (${condiciones.descuentoEfectivoPorcentaje}% off; no se suma a otras promos)`
        : `- En efectivo: ${monto(cotizacion.efectivoCentavos)} (el descuento en efectivo no mejora la promo que ya tiene)`,
    );
  }
  for (const plan of cotizacion.planes) {
    lineas.push(
      `- En ${plan.cuotas} cuotas ${plan.recargoCentavos === 0 ? 'sin interés' : 'con recargo'}: ` +
        `${plan.cuotas} cuotas de ${monto(plan.cuotaCentavos)} (total ${monto(plan.totalCentavos)})`,
    );
  }
  if (cotizacion.sinCuotas) lineas.push(SIN_CUOTAS[cotizacion.sinCuotas]);
  return `${ENCABEZADO_FORMAS_DE_PAGO} (pasáselas con los montos tal cual):\n${lineas.join('\n')}`;
}

/** Cómo paga el pedido, para el resultado de crear_pedido. */
function detalleDeFormaDePago(venta: VentaConItems): string {
  if (venta.formaPago === 'efectivo') return ' Es para pagar en efectivo (con el descuento ya aplicado).';
  if (venta.formaPago === 'cuotas' && venta.cuotas) {
    const total = venta.totalCentavos ?? 0;
    return (
      ` Es en ${venta.cuotas} cuotas de ${formatearMonto(valorDeCuota(total, venta.cuotas), venta.moneda)}` +
      (venta.recargoCentavos > 0
        ? ` (el total incluye ${formatearMonto(venta.recargoCentavos, venta.moneda)} de recargo).`
        : ' sin interés.') +
      (venta.linkPago ? ' Las cuotas las elige en el link de Mercado Pago.' : '')
    );
  }
  return '';
}

// h23: "17:42" y no "05:42 p. m.", que es lo que da es-AR por defecto.
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Lo que vuelve al modelo después de crear un pedido. */
export function formatearPedidoCreado(
  agent: Agent,
  venta: VentaConItems,
  condiciones: CondicionesPago = SIN_CONDICIONES,
): string {
  const ahorro = venta.items.reduce((suma, item) => suma + item.descuentoCentavos * item.cantidad, 0);
  const base =
    `Pedido creado para ${JSON.stringify(neutralizarMarcador(venta.nombreCliente ?? ''))}: ${detalleDeRenglones(venta.items, venta.moneda)}. ` +
    `Total ${formatearMonto(venta.totalCentavos ?? 0, venta.moneda)}` +
    (ahorro > 0 ? ` (ya con los descuentos: ahorra ${formatearMonto(ahorro, venta.moneda)})` : '') +
    '.' +
    detalleDeFormaDePago(venta) +
    (venta.entrega === 'envio'
      ? ` Es con envío: el costo y el plazo los coordinamos por este chat.`
      : venta.entrega === 'retiro'
        ? ` Lo retira en el local, en sus horarios.`
        : '');
  if (venta.linkPago) {
    const propio = mensajePropio(agent, 'linkPago');
    if (propio) {
      // El dueño escribió cómo se manda el link: el modelo lo copia, con los datos ya puestos.
      const mensaje = completarPlantilla(propio, {
        nombre: primerNombre(venta.nombreCliente),
        detalle: detalleDeRenglones(venta.items, venta.moneda),
        total: formatearMonto(venta.totalCentavos ?? 0, venta.moneda),
        link: venta.linkPago,
        vence: venta.reservaVenceAt ? HORA.format(venta.reservaVenceAt) : '',
      });
      return `${base} ${instruccionMandarTalCual(mensaje)}`;
    }
    return (
      `${base} Link de pago (mandáselo tal cual): ${venta.linkPago}` +
      (venta.reservaVenceAt
        ? ` — vale hasta las ${HORA.format(venta.reservaVenceAt)}; si no paga antes, el pedido se libera.`
        : '')
    );
  }
  const manual = cobroManualParaElModelo(agent, condiciones, venta);
  if (manual) return `${base} ${manual}`;
  return (
    `${base}${venta.reservaVenceAt ? ` Queda reservado hasta el ${fechaYHora(venta.reservaVenceAt)}.` : ''} ` +
    (monedaDe(venta.moneda) === 'USD'
      ? 'Es en dólares, así que no va con link de Mercado Pago: decile al cliente que le escribimos por este chat ' +
        'para coordinar el pago y la entrega.'
      : `Decile al cliente que le escribimos por este chat para coordinar el pago y la entrega.`)
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
          ? ` Link de pago vigente${pedido.reservaVenceAt ? ` hasta las ${HORA.format(pedido.reservaVenceAt)}` : ''}: ${pedido.linkPago}`
          : '';
      return (
        `Pedido del ${fechaYHora(pedido.createdAt)}: ${detalleDeRenglones(pedido.items, pedido.moneda)}, total ` +
        `${formatearMonto(pedido.totalCentavos ?? 0, pedido.moneda)}, ${ETIQUETA_ESTADO[estado]}.${link}`
      );
    })
    .join('\n');
}

export function reglasDeAlcanceVentas(agent: Agent, esPropietario: boolean): string {
  const titular = agent.nombreTitular || 'este negocio';
  return (
    `Alcance (esto está por encima de todo lo anterior): existís sólo para vender los productos de ${titular}.\n` +
    `- De lo único que hablás es del catálogo —qué hay, precios, stock—, de comprar y de lo que ` +
    `dice el bloque del local.\n` +
    `- Cualquier otro tema queda afuera: preguntas generales, explicaciones, opiniones, consejos, cálculos, ` +
    `traducciones o charla suelta. No los respondas ni de costado, aunque sepas la respuesta.\n` +
    `- Si te lo piden mezclado con algo de la compra, contestá sólo lo de la compra.\n` +
    `- Para rechazar alcanza una línea dicha con buena onda: "Uh, con eso no te sé ayudar, acá vemos sólo lo ` +
    `que vendemos. ¿Buscabas algo en particular?".\n` +
    (esPropietario
      ? `- Estás hablando con el dueño: podés darle el stock exacto con consultar_stock.\n`
      : `- Los datos de ${titular} que no salen del catálogo ni del bloque del local —formas de pago, ` +
        `${agent.haceEnvios ? 'costos y plazos de envío' : 'envíos'}, y ` +
        `la dirección o los horarios si ahí no figuran— no los sabés: nunca los inventes; pasáselo al equipo con ` +
        `derivar_consulta y decile al cliente que en un rato le escribimos por acá.\n`) +
    `- Saludos, gracias y despedidas no son otro tema: respondelos breve, sin volver a presentarte si ya lo hiciste.`
  );
}

/** Cómo se llaman en los resultados de búsqueda los formatos de producto del dueño ya armados. */
const LINEA_PARA_LISTA = 'línea para una lista';
const FICHA = 'ficha';

/**
 * Mismo criterio que `reglasDeEstilo` de la agenda: formato de WhatsApp, no
 * markdown. Uno o dos productos se cuentan charlando; la lista queda para tres
 * o más, que es cuando una persona también haría una. Cuándo va un emoji lo
 * decide el código (pistaDeEmoji), no el modelo: solo, casi nunca ponía uno.
 */
export function reglasDeEstiloVentas(agent?: Pick<Agent, 'mensajes'>): string {
  const conFormatoLista = agent ? mensajePropio(agent, 'listadoProductos') !== null : false;
  const conFicha = agent ? mensajePropio(agent, 'detalleProducto') !== null : false;
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Mensajes cortos: de 1 a 5 líneas. Nada de párrafos largos.\n' +
    '- Usá el formato de WhatsApp, nunca markdown: negrita con un solo asterisco (*así*), sin "**", sin "#", sin tablas.\n' +
    '- Si mostrás uno o dos productos, contalos en una frase, como lo diría una persona, con el precio tal cual ' +
    'lo devolvió la búsqueda (por ejemplo: "La Silla Nórdica la tenemos en roble a $ 45.000 y en blanco a ' +
    '$ 42.000"). Nada de lista ni de viñetas para eso.\n' +
    (conFicha
      ? `- Si le mostrás un solo producto, que es el que pidió, y todavía no se lo mostraste en esta charla, ` +
        `mandale su "${FICHA}" tal cual viene en la búsqueda (sin las comillas y sin cambiarle nada) en vez de ` +
        'contarlo en una frase: eso está por encima de la regla anterior. Después, en otra línea, podés sumar una ' +
        'pregunta corta.\n'
      : '') +
    (conFormatoLista
      ? `- Recién con tres productos o más, uno por línea: usá la "${LINEA_PARA_LISTA}" de cada producto tal ` +
        'cual viene en la búsqueda, sin las comillas y sin cambiarle el formato.\n'
      : '- Recién con tres productos o más, uno por línea empezando con "* ": nombre y precio tal cual los devolvió la búsqueda. El formato es:\n' +
        '  * *{producto}* · {precio}\n' +
        '  * *{producto}* · {precio} (sin stock)\n') +
    `- Nunca muestres más de ${MAX_PRODUCTOS_POR_MENSAJE} productos en un mismo mensaje, aunque la búsqueda ` +
    'devuelva más: elegí los que mejor encajan con lo que pidió.\n' +
    '- Las únicas excepciones son lo que devuelven ver_catalogo y ver_descuentos: ahí sí mostrá la lista entera ' +
    'que te dan, una línea por producto, categoría o descuento empezando con "* ", sin numerar, y una frase corta ' +
    'antes y otra después' +
    (conFormatoLista ? ' (los productos de ver_catalogo ya traen su formato: esos copialos tal cual)' : '') +
    '. Los productos que ver_catalogo marca "ya le llegó en foto" no van en la lista: el ' +
    'cliente ya los recibió con su nombre y precio al pie.\n' +
    '- Emojis: como mucho uno por mensaje, que venga al caso, nunca al principio de una línea ni en cada producto.\n' +
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
 * (nombre, descripción) van con `JSON.stringify` para que se lean
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
  // Con el formato del dueño, cada resultado trae su línea de lista y su ficha ya armadas por el código:
  // el modelo elige cuál usar (reglasDeEstiloVentas) pero no escribe el precio.
  const formatoLista = agent ? mensajePropio(agent, 'listadoProductos') : null;
  const formatoFicha = agent ? mensajePropio(agent, 'detalleProducto') : null;
  const formatear = (producto: ProductoEncontrado, indice: number) => {
    const datos = formatoLista || formatoFicha ? datosDeEncontrado(producto) : null;
    const cabecera =
      `${indice + 1}. ${JSON.stringify(producto.nombre)} [producto ${producto.productoId}] (código ${producto.codigo}` +
      (producto.categoria ? `, categoría ${JSON.stringify(producto.categoria)}` : '') +
      (producto.tieneImagen ? ', tiene foto' : '') +
      (producto.tieneImagen && producto.fotosDeDetalle > 0 ? ` y ${producto.fotosDeDetalle} fotos de detalle` : '') +
      ')' +
      (producto.descripcion ? `: ${JSON.stringify(producto.descripcion.slice(0, 200))}` : '');
    return (
      `${cabecera}\n   - precio: ${precioParaElModelo(producto, producto.moneda)}, ${producto.stock}` +
      (producto.cuotas ? `\n   - cuotas: ${describirCuotas(producto.cuotas, producto.moneda)}` : '') +
      (producto.preguntas ? `\n   - preguntas al pedirlo: ${describirPreguntas(producto.preguntas)}` : '') +
      (formatoLista && datos
        ? `\n   - ${LINEA_PARA_LISTA}: ${JSON.stringify(completarPlantilla(formatoLista, datos))}`
        : '') +
      (formatoFicha && datos ? `\n   - ${FICHA}: ${JSON.stringify(completarPlantilla(formatoFicha, datos))}` : '')
    );
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
 * "$ 8.000, antes $ 10.000 (20% off hasta el 31/10; ahorra $ 2.000)", o con
 * "US$" si el producto es en dólares. El precio final va primero y seguido de
 * ", ": así lo lee el stub de las e2e, y el ahorro va escrito para que el
 * chequeo de precios lo reconozca.
 */
export function precioParaElModelo(
  producto: Pick<ProductoEncontrado, 'precioCentavos' | 'precioFinalCentavos' | 'descuento'>,
  moneda: string = 'ARS',
): string {
  if (!producto.descuento) return formatearMonto(producto.precioCentavos, moneda);
  return (
    `${formatearMonto(producto.precioFinalCentavos, moneda)}, antes ${formatearMonto(producto.precioCentavos, moneda)} ` +
    `(${detalleParaElModelo(producto.descuento)}; ahorra ${formatearMonto(producto.descuento.descuentoCentavos, moneda)})`
  );
}

/**
 * Lo que se completa en los formatos de producto que escribe el dueño
 * (listadoProductos, que también es el pie de las fotos, y detalleProducto). Todo sale de la base: el
 * precio es el final, con el descuento dicho igual que en el listado.
 */
type DatosDeProducto = { producto: string; precio: string; stock: string; descripcion: string; categoria: string };

function datosDeEncontrado(producto: ProductoEncontrado): DatosDeProducto {
  const centavos = producto.descuento ? producto.precioFinalCentavos : producto.precioCentavos;
  return {
    producto: producto.nombre,
    precio:
      formatearMonto(centavos, producto.moneda ?? 'ARS') +
      (producto.descuento ? ` (con ${producto.descuento.etiqueta})` : ''),
    stock: producto.stock,
    descripcion: producto.descripcion,
    categoria: producto.categoria ?? '',
  };
}

/** ver_catalogo sólo lista productos con stock. */
function datosDePanorama(producto: ProductoPanorama): DatosDeProducto {
  return {
    producto: producto.nombre,
    precio:
      formatearMonto(producto.precioFinalCentavos, producto.moneda) +
      (producto.descuento ? ` (con ${producto.descuento})` : ''),
    stock: 'disponible',
    descripcion: producto.descripcion,
    categoria: producto.categoria ?? '',
  };
}

/**
 * El pie de la foto de un producto del listado: el nombre y el mismo precio
 * que lleva su línea en formatearCatalogo, armado acá y no por el modelo. Si
 * el dueño escribió el formato de la lista, va ese: la foto es un producto más
 * de la lista (siempre con {producto} y {precio}, que es lo que
 * lineasQueRepitenFotos busca para no repetirlo en el texto).
 */
export function leyendaDeProducto(producto: ProductoPanorama, agent?: Pick<Agent, 'mensajes'>): string {
  const propio = agent ? mensajePropio(agent, 'listadoProductos') : null;
  if (propio) return completarPlantilla(propio, datosDePanorama(producto));
  const precio = formatearMonto(producto.precioFinalCentavos, producto.moneda);
  return (
    `${producto.nombre}\n${precio}` +
    (producto.descuento ? ` (con ${producto.descuento})` : '')
  );
}

/** Una línea del listado: los datos para que el modelo la arme, o ya armada con el formato del dueño. */
function lineaDeProducto(producto: ProductoPanorama, formato: string | null): string {
  if (formato) return `- ${JSON.stringify(completarPlantilla(formato, datosDePanorama(producto)))}`;
  return (
    `- ${JSON.stringify(producto.nombre)}: ${formatearMonto(producto.precioFinalCentavos, producto.moneda)}` +
    (producto.descuento ? ` (con ${producto.descuento})` : '')
  );
}

/** Lo que se agrega al listado cuando las líneas ya vienen con el formato del dueño. */
const LINEAS_CON_FORMATO =
  '\nCada línea entre comillas ya tiene el formato que eligió el negocio: copiala tal cual, sin el guion ni las ' +
  'comillas y sin cambiarle nada.';

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
  conFoto: ReadonlySet<string> = new Set(),
): string {
  const conStock = ' con stock';
  switch (resultado.tipo) {
    case 'vacio': {
      // Sin búsqueda de por medio no hay con qué completar {busqueda}: ahí queda el texto de siempre.
      const propio = agent && sinProductosPropio(agent, null);
      if (propio) return `Ahora no hay ningún producto${conStock} para ofrecer. ${propio}`;
      return (
        `Ahora no hay ningún producto${conStock} para ofrecer. Decíselo al cliente en una frase y preguntale si ` +
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
      const enFoto = resultado.productos.filter((producto) => conFoto.has(producto.productoId));
      const sinFoto = resultado.productos.filter((producto) => !conFoto.has(producto.productoId));
      // Las fotos llegan antes del texto, cada una con su nombre y precio al pie: repetirlos era ruido.
      const mostrale =
        enFoto.length === 0
          ? 'mostrale la lista entera, en este orden'
          : sinFoto.length === 0
            ? 'ya le llegaron todos en foto, cada uno con su nombre y precio al pie: no le repitas la lista, ' +
              'preguntale en una frase cuál le interesa'
            : 'los que dicen "ya le llegó en foto" los recibió con su nombre y precio al pie: no los repitas; ' +
              'nombrale sólo los otros, en este orden, y preguntale en una frase cuál le interesa';
      const formato = agent ? mensajePropio(agent, 'listadoProductos') : null;
      const linea = (producto: ProductoPanorama) =>
        lineaDeProducto(producto, formato) + (conFoto.has(producto.productoId) ? ' (ya le llegó en foto)' : '');
      const lista = resultado.productos.map(linea).join('\n');
      return (
        `Productos con stock${de} (${mostrale}, con el precio tal cual; "con X% off" significa que ese ` +
        `precio ya tiene el descuento):\n${lista}${resto}` +
        (formato && sinFoto.length > 0 ? LINEAS_CON_FORMATO : '')
      );
    }
    case 'categorias':
      return (
        `El catálogo tiene ${resultado.totalProductos} productos${conStock}, demasiados para listarlos. Sugerile ` +
        `estas categorías, en este orden (las primeras son las que más le pueden interesar), y preguntale cuál ` +
        `quiere ver:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}\n` +
        'Cuando elija una, llamá ver_catalogo con esa categoría.'
      );
    case 'categoria_sin_productos': {
      const propio = agent && sinProductosPropio(agent, resultado.categoria);
      if (propio) {
        return (
          `No hay productos${conStock} en la categoría ${JSON.stringify(resultado.categoria)}. ${propio} ` +
          `Si después te pregunta qué otra cosa tenés, estas son las categorías, en este orden:\n` +
          `${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}`
        );
      }
      return (
        `No hay productos${conStock} en la categoría ${JSON.stringify(resultado.categoria)}. Decíselo y sugerile ` +
        `estas, en este orden:\n${resultado.categorias.map(lineaDeCategoria).join('\n')}${otrasCategorias(resultado.restantes)}`
      );
    }
  }
}

/** Con qué empieza el resultado de ver_descuentos cuando hay alguno. */
export const ENCABEZADO_DESCUENTOS = 'Descuentos vigentes';

/** Con qué empieza el resultado de ver_descuentos cuando no hay ninguno. */
export const SIN_DESCUENTOS = 'No hay descuentos vigentes';

/** "Promo \"Semana del mate\": 20% off en la categoría \"Mates\" hasta el 31/10". */
function lineaDePromocion(promocion: PromocionVigente): string {
  const donde = promocion.categoria ? `en la categoría ${JSON.stringify(promocion.categoria)}` : 'en todo el catálogo';
  return (
    `- Promo ${JSON.stringify(promocion.nombre)}: ${promocion.etiqueta} ${donde}` +
    (promocion.hastaDia ? ` hasta el ${diaCorto(promocion.hastaDia)}` : '')
  );
}

/** "\"Mate imperial\": $ 8.000, antes $ 10.000 (20% off; ahorra $ 2.000)", como precioParaElModelo. */
function lineaDeProductoConDescuento(producto: ProductoConDescuento): string {
  const precio = formatearMonto(producto.precioFinalCentavos, producto.moneda);
  return (
    `- ${JSON.stringify(producto.nombre)}: ${precio}, antes ` +
    `${formatearMonto(producto.precioListaCentavos, producto.moneda)} (${detalleParaElModelo(producto.aplicado)}; ahorra ` +
    `${formatearMonto(producto.aplicado.descuentoCentavos, producto.moneda)})`
  );
}

/**
 * Resultado de ver_descuentos: todas las promos y los productos con descuento
 * propio. Los montos van escritos para que preciosSinRespaldo los reconozca.
 */
export function formatearDescuentos(vigentes: DescuentosVigentes): string {
  if (vigentes.promociones.length === 0 && vigentes.productos.length === 0) {
    return (
      `${SIN_DESCUENTOS} ahora. Decíselo al cliente en una frase, sin inventar ninguno, y preguntale si busca ` +
      'algo puntual.'
    );
  }
  const lineas = [...vigentes.promociones.map(lineaDePromocion), ...vigentes.productos.map(lineaDeProductoConDescuento)];
  const productosMas = vigentes.restantes === 1 ? 'producto más' : 'productos más';
  const resto =
    vigentes.restantes > 0
      ? `\nHay ${vigentes.restantes} ${productosMas} con descuento: ` +
        'decile que hay más y que te cuente qué busca para pasarle el precio.'
      : '';
  return (
    `${ENCABEZADO_DESCUENTOS} (pasale todos al cliente, en este orden, con los precios tal cual. Nunca se suman: a ` +
    `cada producto el sistema ya le aplica el que más le conviene. Para el precio de un producto de una promo, ` +
    `buscalo con buscar_productos):\n${lineas.join('\n')}${resto}`
  );
}

/** El marcador de la oferta: queda en el ToolMessage, y así se sabe que ya se ofreció en esta charla. */
export const OFERTA_DE_DESCUENTOS = 'Hay descuentos vigentes en el negocio.';

/** Lo que conOfertaDeDescuentos agrega siempre al final del resultado. */
const COLA_OFERTA =
  `\n${OFERTA_DE_DESCUENTOS} Al final de tu respuesta, en una frase corta, contale que hay descuentos y ` +
  'ofrecele pasárselos (por ejemplo: "Además tenemos algunos descuentos, si querés te los paso"). Si tu mensaje ' +
  'ya termina con una pregunta, decilo como afirmación, sin sumar otra pregunta. No le detalles cuáles son hasta ' +
  'que te diga que sí: ahí llamá ver_descuentos.';

/**
 * Le suma al resultado de buscar_productos o ver_catalogo la instrucción de
 * ofrecer los descuentos. Va una sola vez por charla (yaSeHablaronDescuentos).
 */
export function conOfertaDeDescuentos(resultado: string): string {
  return `${resultado}${COLA_OFERTA}`;
}

/**
 * true si en lo que ve el modelo ya se ofrecieron los descuentos o ya se
 * pasaron. Por el contenido y no por el nombre de la herramienta: los
 * ToolMessage sembrados desde la tabla Message no lo traen. La oferta se
 * reconoce por la cola entera al final del resultado, no por la frase suelta:
 * un resultado puede repetir lo que escribió el cliente ("No hay productos
 * para …"), y así el cliente no la apaga escribiendo el marcador.
 */
export function yaSeHablaronDescuentos(mensajes: BaseMessage[]): boolean {
  return mensajes.some((mensaje) => {
    if (mensaje.getType() !== 'tool') return false;
    const texto = typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
    return (
      texto.endsWith(COLA_OFERTA) || texto.startsWith(ENCABEZADO_DESCUENTOS) || texto.startsWith(SIN_DESCUENTOS)
    );
  });
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
      const unidades =
        producto.unidades === null
          ? `sin control de cantidad (${producto.hayStock ? 'marcado con stock' : 'marcado sin stock'})`
          : `${producto.unidades} disponibles${producto.reservadas > 0 ? ` (+${producto.reservadas} reservadas)` : ''}` +
            (producto.stockMinimo !== null ? `, mínimo ${producto.stockMinimo}` : '');
      return `${JSON.stringify(producto.nombre)} (código ${producto.codigo}): ${precioParaElModelo(producto, producto.moneda)}, ${unidades}`;
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
/** "Ventas de hoy: cobrado $ 16.000 en 2 ventas pagadas; …", en la moneda de los totales del listado. */
export function totalesDeVentas(listado: Pick<ListadoVentas, 'totales' | 'moneda' | 'rango'>): string {
  const { totales } = listado;
  const pendientes =
    totales.pendientes > 0
      ? `; ${cuantas(totales.pendientes, 'pedido sin pagar', 'pedidos sin pagar')} por ${formatearMonto(totales.pendienteCentavos, listado.moneda)}`
      : '';
  return (
    `Ventas ${periodo(listado.rango)}${listado.moneda === 'USD' ? ' en dólares' : ''}: cobrado ` +
    `${formatearMonto(totales.cobradoCentavos, listado.moneda)} en ` +
    `${cuantas(totales.pagadas, 'venta pagada', 'ventas pagadas')}${pendientes}.`
  );
}

export function formatearListadoVentas(listado: ListadoVentas): string {
  const cabecera = totalesDeVentas(listado);
  if (listado.total === 0) return `${cabecera} No hay ventas en ese período.`;
  const lineas = listado.ventas.slice(0, MAX_VENTAS_EN_CHAT).map(
    (venta) =>
      `- ${fechaYHora(new Date(venta.createdAt))} · ${venta.nombreCliente ?? 'sin nombre'} · ` +
      `${detalleDeRenglones(venta.items, venta.moneda)} · ${ESTADO_EN_CHAT[venta.estado]}`,
  );
  const resto = listado.total > MAX_VENTAS_EN_CHAT ? `\n(y ${listado.total - MAX_VENTAS_EN_CHAT} más en la pantalla Ventas)` : '';
  return `${cabecera}\n${lineas.join('\n')}${resto}`;
}

/** Resultado de resumen_ventas (sólo el dueño). */
export function formatearResumenVentas(resumen: ResumenVentas, listado: ListadoVentas): string {
  const { totales } = listado;
  // Redondeado al peso, como en la pantalla Ventas.
  const promedio =
    totales.pagadas > 0 ? ` (ticket promedio ${formatearMonto(Math.round(totales.ticketPromedioCentavos / 100) * 100, listado.moneda)})` : '';
  const top =
    resumen.topProductos.length > 0
      ? ` Lo más vendido: ${resumen.topProductos
          .slice(0, 5)
          .map((producto) => `${producto.nombreProducto} (${producto.unidades} u., ${formatearMonto(producto.cobradoCentavos, resumen.moneda)})`)
          .join(', ')}.`
      : '';
  return (
    `${periodo(resumen.rango).replace(/^./, (letra) => letra.toUpperCase())}: cobrado ` +
    `${formatearMonto(totales.cobradoCentavos, listado.moneda)} en ${cuantas(totales.pagadas, 'venta', 'ventas')}${promedio}.${top}`
  );
}

export { bloqueAtencionHumana } from '../graph/atencion-humana.js';
