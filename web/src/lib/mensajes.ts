/**
 * Los mensajes que el dueño puede escribir a mano en /asistente. Las claves,
 * los datos permitidos y las validaciones son una copia a mano de
 * api/src/agents/mensajes.rules.ts: la API es la que decide, esto sólo evita
 * mandar algo que va a rechazar.
 */

import { MENSAJE_COBRO_SUGERIDO, VARIABLES_MENSAJE_COBRO } from "./condiciones-pago";

export type ClaveMensaje =
  | "saludo"
  | "linkPago"
  | "sinProductos"
  | "pagoAprobado"
  | "horarioOcupado"
  | "listadoProductos"
  | "detalleProducto";
/**
 * El mensaje del cobro por "otro canal" también se edita en /asistente, pero no
 * es de `Agent.mensajes`: vive en las condiciones de pago (PUT /condiciones-pago).
 */
export const CLAVE_COBRO = "cobroOtroCanal";
export type ClaveItem = ClaveMensaje | typeof CLAVE_COBRO;
export type ModoMensaje = "auto" | "propio";
/** `fotos` sólo en la lista de productos: si sale con la foto de cada uno. Sin el campo, sale con fotos. */
export type MensajeConfigurado = { modo: ModoMensaje; texto: string; fotos?: boolean };
export type MensajesAgente = Partial<Record<ClaveMensaje, MensajeConfigurado>>;
export type TipoAsistente = "agenda" | "ventas";

export const MAX_CARACTERES_MENSAJE = 400;

export type DefinicionMensaje = {
  clave: ClaveItem;
  nombre: string;
  descripcion: string;
  /** Cuándo se manda, en una frase. */
  cuando: string;
  variables: string[];
  obligatorias: string[];
  /** Sólo una sugerencia: guardar sin ellas se puede. */
  recomendadas: string[];
  /** El punto de partida de "Mi mensaje" y de "Usar el texto sugerido". */
  sugerido: string;
  /** Lo que escribe el cliente en la vista previa. */
  ejemploCliente: string;
  /** Cómo lo diría el asistente en automático, para la vista previa. */
  ejemploAuto: string;
  /** Hoy ya es un texto fijo (no lo redacta el modelo). */
  fijo: boolean;
  /** No hay modo automático: siempre se manda el texto del dueño. */
  soloPropio?: boolean;
  /** Es el formato de cada producto: la vista previa lo repite con estos datos, uno por línea. */
  porProducto?: Record<string, string>[];
  /**
   * Se puede mandar con la foto de cada producto, y el texto va al pie de cada
   * una. `pieEstandar` es el pie en automático: el modelo no escribe pies de foto.
   */
  fotos?: { pieEstandar: string };
};

/** Si ese mensaje sale con fotos: sólo los que las admiten, y salvo que el dueño las apague. */
export function conFotos(definicion: DefinicionMensaje, mensaje: MensajeConfigurado): boolean {
  return definicion.fotos !== undefined && mensaje.fotos !== false;
}

/** El mensaje que se manda cuando el pedido se cobra por otro canal (sólo ventas). */
export const MENSAJE_COBRO_OTRO_CANAL: DefinicionMensaje = {
  clave: CLAVE_COBRO,
  nombre: "Cobro por otro canal",
  descripcion: "Cuando el pedido se cobra sin link",
  cuando:
    "Se manda cuando el cliente cierra un pedido que no va con link de Mercado Pago. Después, tu asistente deja el chat en tus manos hasta que marques el pedido pagado o lo canceles en Ventas.",
  variables: [...VARIABLES_MENSAJE_COBRO],
  obligatorias: [],
  recomendadas: [],
  sugerido: MENSAJE_COBRO_SUGERIDO,
  ejemploCliente: "No, nada más. Soy Sofía",
  ejemploAuto: MENSAJE_COBRO_SUGERIDO,
  fijo: true,
  soloPropio: true,
};

/** Nombre legible de cada dato, para los botones del editor. */
export const ETIQUETAS_VARIABLE: Record<string, string> = {
  asistente: "Nombre del asistente",
  negocio: "Tu negocio",
  titular: "Tu nombre",
  nombre: "Nombre del cliente",
  total: "Total del pedido",
  link: "Link de pago",
  vence: "Hasta qué hora vale",
  detalle: "Qué pidió",
  busqueda: "Lo que buscó",
  horario_pedido: "Horario que pidió",
  sugerencia: "Horarios libres cercanos",
  producto: "Nombre del producto",
  precio: "Precio",
  stock: "Stock",
  descripcion: "Descripción",
  categoria: "Categoría",
};

/** Productos inventados para la vista previa de la lista. */
const PRODUCTOS_DE_EJEMPLO: Record<string, string>[] = [
  { producto: "Yerba 1 kg", precio: "$ 5.000", stock: "disponible" },
  { producto: "Mate de calabaza", precio: "$ 8.000 (con 20% off)", stock: "quedan 2 unidades" },
  { producto: "Bombilla de acero", precio: "$ 3.500", stock: "disponible" },
];

const CUANDO_SALUDO =
  "Se manda una sola vez, cuando un cliente escribe por primera vez en la conversación. Después el asistente sigue la charla sin volver a saludar.";

export function mensajesDe(tipo: TipoAsistente): DefinicionMensaje[] {
  if (tipo === "agenda") {
    return [
      {
        clave: "saludo",
        nombre: "Saludo",
        descripcion: "Primer mensaje de cada charla",
        cuando: CUANDO_SALUDO,
        variables: ["asistente", "titular"],
        obligatorias: [],
        recomendadas: [],
        sugerido: "¡Hola! Soy {asistente}, la asistente de {titular}. Contame qué día te queda cómodo y te busco un turno.",
        ejemploCliente: "Hola, quería sacar un turno",
        ejemploAuto: "¡Hola! Soy {asistente}, de {titular}. Contame qué día te queda cómodo y te busco un horario.",
        fijo: false,
      },
      {
        clave: "horarioOcupado",
        nombre: "Horario ocupado",
        descripcion: "Cuando piden un horario que no está libre",
        cuando:
          "Se manda cuando el horario que pide el cliente choca con otro turno o con un evento de tu agenda. Si no queda ningún horario libre cerca, el asistente pide otra fecha con sus palabras.",
        variables: ["horario_pedido", "sugerencia", "titular"],
        obligatorias: [],
        recomendadas: ["sugerencia"],
        sugerido: "Uy, {horario_pedido} ya está ocupado. Lo más cercano que tengo libre es {sugerencia}. ¿Te sirve?",
        ejemploCliente: "¿Puede ser el jueves a las 14?",
        ejemploAuto: "El jueves a las 14 ya está tomado. Lo más cercano que tengo es el jueves a las 14:30. ¿Te sirve?",
        fijo: false,
      },
    ];
  }
  return [
    {
      clave: "saludo",
      nombre: "Saludo",
      descripcion: "Primer mensaje de cada charla",
      cuando: CUANDO_SALUDO,
      variables: ["asistente", "negocio"],
      obligatorias: [],
      recomendadas: [],
      sugerido: "¡Hola! Soy {asistente}, de {negocio}. ¿En qué te puedo ayudar?",
      ejemploCliente: "Hola! tienen yerba?",
      ejemploAuto: "¡Hola! Soy {asistente}, de {negocio}. Sí, tengo yerba: ¿buscás alguna en particular?",
      fijo: false,
    },
    {
      clave: "linkPago",
      nombre: "Link de pago",
      descripcion: "Cuando el pedido queda listo para pagar",
      cuando:
        "Se manda cuando el cliente cierra el pedido y Mercado Pago genera el link. El pedido queda reservado mientras el link está vigente.",
      variables: ["nombre", "detalle", "total", "link", "vence"],
      obligatorias: ["link"],
      recomendadas: ["vence"],
      sugerido: "¡Genial, {nombre}! Tu pedido es de {total}. Pagalo acá:\n{link}\nEl link vale hasta las {vence}; después el pedido se libera.",
      ejemploCliente: "No, nada más. Soy Sofía",
      ejemploAuto: "Listo, Sofía. Te anoté {detalle}, son {total}. Pagalo acá: {link}. El link vale hasta las {vence}.",
      fijo: false,
    },
    {
      clave: "sinProductos",
      nombre: "No hay más productos",
      descripcion: "Cuando no tenés lo que te piden",
      cuando: "Se manda cuando lo que busca el cliente no está en tu catálogo o no queda nada con stock para ofrecer.",
      variables: ["busqueda", "negocio"],
      obligatorias: [],
      recomendadas: [],
      sugerido: "Uy, {busqueda} no me queda por ahora. ¿Querés que te muestre lo que tengo?",
      ejemploCliente: "¿Tenés yerba orgánica?",
      ejemploAuto: "Uh, {busqueda} no tengo por ahora. ¿Buscás alguna otra cosa?",
      fijo: false,
    },
    {
      clave: "pagoAprobado",
      nombre: "Pago recibido",
      descripcion: "Cuando Mercado Pago aprueba el pago",
      cuando: "Se manda solo, apenas Mercado Pago confirma el pago o vos marcás el pedido como pagado en Ventas.",
      variables: ["nombre", "total", "detalle", "negocio"],
      obligatorias: [],
      recomendadas: [],
      sugerido: "¡Listo, {nombre}! Tu pago de {total} fue aprobado. {negocio} te escribe por acá para coordinar la entrega.",
      ejemploCliente: "(paga con el link)",
      ejemploAuto: "¡Listo, {nombre}! Tu pago de {total} fue aprobado. {negocio} te escribe por acá para coordinar la entrega.",
      fijo: true,
    },
    {
      clave: "listadoProductos",
      nombre: "Lista de productos",
      descripcion: "Cómo se ve cada producto, con su foto o sin ella",
      cuando:
        "Se usa cuando tu asistente muestra tres productos o más, o la lista de tu catálogo. Escribís cómo va un producto y se repite para cada uno; los precios salen siempre de tu catálogo. Si mandás las fotos, el texto de cada producto va al pie de su foto.",
      variables: ["producto", "precio", "stock"],
      obligatorias: ["producto", "precio"],
      recomendadas: [],
      sugerido: "▪️ *{producto}* — {precio}",
      ejemploCliente: "¿Qué tenés para el mate?",
      ejemploAuto: "* *{producto}* · {precio}",
      fijo: false,
      porProducto: PRODUCTOS_DE_EJEMPLO,
      fotos: { pieEstandar: "{producto}\n{precio}" },
    },
    {
      clave: "detalleProducto",
      nombre: "Ficha de un producto",
      descripcion: "Cuando muestra un solo producto",
      cuando:
        "Se manda la primera vez que tu asistente le muestra al cliente un único producto, el que pidió. Después sigue la charla con sus palabras. El precio y el stock salen siempre de tu catálogo.",
      variables: ["producto", "precio", "stock", "descripcion", "categoria"],
      obligatorias: ["producto", "precio"],
      recomendadas: [],
      sugerido: "*{producto}*\n{descripcion}\n💲 {precio} · {stock}",
      ejemploCliente: "¿Tenés yerba?",
      ejemploAuto: "Sí, la {producto} la tenemos a {precio}. ¿Te la anoto?",
      fijo: false,
    },
  ];
}

/** Datos inventados para la vista previa; los nombres del negocio salen del asistente real. */
export function datosDeEjemplo(nombreBot: string, nombreTitular: string): Record<string, string> {
  return {
    asistente: nombreBot,
    negocio: nombreTitular,
    titular: nombreTitular,
    nombre: "Sofía",
    total: "$ 18.500",
    link: "mpago.la/2Xk9",
    vence: "16:40",
    detalle: "2 × Yerba 1 kg",
    busqueda: "yerba orgánica",
    horario_pedido: "el jueves a las 14:00",
    sugerencia: "el jueves a las 14:30 o a las 16:00",
    producto: "Yerba 1 kg",
    precio: "$ 5.000",
    stock: "disponible",
    descripcion: "Yerba con palo, estacionada 24 meses.",
    categoria: "Almacén",
  };
}

const VARIABLE = /\{(\w+)\}/g;

export function variablesUsadas(texto: string): string[] {
  return [...texto.matchAll(VARIABLE)].map((coincidencia) => coincidencia[1]);
}

/** El texto partido en tramos fijos y datos, para resaltar los datos en la vista previa. */
export function partesDelTexto(texto: string, datos: Record<string, string>): { texto: string; dato: boolean }[] {
  return texto
    .split(/(\{\w+\})/)
    .filter((parte) => parte !== "")
    .map((parte) => {
      const clave = /^\{(\w+)\}$/.exec(parte)?.[1];
      return clave && datos[clave] !== undefined ? { texto: datos[clave], dato: true } : { texto: parte, dato: false };
    });
}

export type Validacion = { error: string | null; aviso: string | null };

export function validarMensaje(definicion: DefinicionMensaje, mensaje: MensajeConfigurado): Validacion {
  if (mensaje.modo !== "propio") return { error: null, aviso: null };
  const texto = mensaje.texto.trim();
  if (!texto) return { error: "Escribí el mensaje, o volvé a dejarlo en automático.", aviso: null };
  if (texto.length > MAX_CARACTERES_MENSAJE) {
    return { error: `Es demasiado largo para WhatsApp: dejalo en ${MAX_CARACTERES_MENSAJE} caracteres o menos.`, aviso: null };
  }
  const usadas = variablesUsadas(texto);
  const desconocida = usadas.find((variable) => !definicion.variables.includes(variable));
  if (desconocida) {
    return { error: `{${desconocida}} no es un dato que se pueda completar acá. Borralo o elegí uno de los botones.`, aviso: null };
  }
  const faltante = definicion.obligatorias.find((variable) => !usadas.includes(variable));
  if (faltante) {
    return { error: `Falta el dato «${ETIQUETAS_VARIABLE[faltante]}»: sin él el mensaje no sirve.`, aviso: null };
  }
  const sinRecomendada = definicion.recomendadas.find((variable) => !usadas.includes(variable));
  if (sinRecomendada) {
    return { error: null, aviso: `Te recomendamos sumar «${ETIQUETAS_VARIABLE[sinRecomendada]}», así el cliente tiene el dato a mano.` };
  }
  return { error: null, aviso: null };
}

/**
 * Inserta `{variable}` en la posición del cursor, separándolo con espacios
 * sólo si hace falta. Devuelve el texto nuevo y dónde queda el cursor.
 */
export function insertarVariable(texto: string, cursor: number | null, variable: string): { texto: string; cursor: number } {
  const posicion = cursor === null ? texto.length : Math.min(Math.max(cursor, 0), texto.length);
  const antes = texto.slice(0, posicion);
  const despues = texto.slice(posicion);
  const token =
    (antes && !/\s$/.test(antes) ? " " : "") + `{${variable}}` + (despues && !/^[\s.,;:!?)]/.test(despues) ? " " : "");
  return { texto: antes + token + despues, cursor: posicion + token.length };
}
