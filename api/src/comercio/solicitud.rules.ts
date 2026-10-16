/**
 * Productos a medida (LAU-22): qué le pregunta el asistente al cliente para
 * que el comercio pueda presupuestar. Funciones puras, igual que
 * datos-cliente.rules.ts: las usan el endpoint que guarda el producto y, más
 * adelante, el pedido que junta las respuestas.
 *
 * La configuración vive en `Producto.solicitud` (Json, `null` = no se hace a
 * medida). Las preguntas se identifican por su texto, como los datos del
 * cliente: lo que contestó el cliente se guardará como foto
 * `{ pregunta, respuesta }`, así un pedido viejo no se rompe si el dueño
 * cambia o borra la pregunta.
 *
 * Las preguntas son opcionales (`{ preguntas: [] }` sigue siendo un producto
 * a medida: el asistente pregunta lo básico) y van en el orden en que el dueño
 * las cargó, que es el orden en que el asistente las hace. Sin opciones es de
 * respuesta escrita; con opciones, `textoLibre` deja contestar otra cosa
 * cuando ninguna le sirve. `sobre` (lo que el cliente ya tiene o lo que pide)
 * quedó de la primera versión: la pantalla ya no lo pide y lo nuevo se guarda
 * como `solicita`.
 *
 * Los materiales con los que se hace el producto (`Producto.materiales`) son
 * una lista aparte, también opcional: el asistente ofrece sólo esos.
 */
import type { ModalidadVenta } from '../agents/modalidad-venta.js';
import { claveDeCampo } from './datos-cliente.rules.js';

export const SOBRE_PREGUNTA = ['tiene', 'solicita'] as const;
export type SobrePregunta = (typeof SOBRE_PREGUNTA)[number];

export const MAX_PREGUNTAS = 15;
export const MAX_OPCIONES = 12;
export const LARGO_MIN_PREGUNTA = 3;
export const LARGO_MAX_PREGUNTA = 120;
export const LARGO_MAX_OPCION = 60;
export const MAX_MATERIALES = 20;
export const LARGO_MAX_MATERIAL = 60;
/** Lo que se guarda de cada respuesta del cliente. */
export const LARGO_MAX_RESPUESTA = 300;

export type PreguntaSolicitud = {
  texto: string;
  sobre: SobrePregunta;
  opciones: string[];
  textoLibre: boolean;
  obligatoria: boolean;
};

export type SolicitudADemanda = { preguntas: PreguntaSolicitud[] };

/** Lo que manda la pantalla, ya con la forma validada por el DTO. */
export type SolicitudEntrada = {
  preguntas: ReadonlyArray<{
    texto: string;
    sobre?: string;
    opciones?: readonly string[];
    textoLibre?: boolean;
    obligatoria?: boolean;
  }>;
};

/** Una respuesta del cliente tal como quedará en el pedido. */
export type RespuestaSolicitud = { pregunta: string; respuesta: string };

export type ResultadoRespuestas =
  | { ok: true; respuestas: RespuestaSolicitud[] }
  | { ok: false; motivo: string; faltantes: string[] };

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esSobre(valor: unknown): valor is SobrePregunta {
  return typeof valor === 'string' && (SOBRE_PREGUNTA as readonly string[]).includes(valor);
}

/** Un texto del dueño en una sola línea: un salto de línea en el prompt se lee como otra regla. */
export function enUnaLinea(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/** Por qué una pregunta (ya en una línea) no se puede guardar, o null. */
function problemaDePregunta(pregunta: PreguntaSolicitud, numero: number): string | null {
  const cual = pregunta.texto ? JSON.stringify(pregunta.texto) : `${numero}`;
  if (pregunta.texto.length < LARGO_MIN_PREGUNTA) return `Escribí la pregunta ${numero}.`;
  if (pregunta.texto.length > LARGO_MAX_PREGUNTA) return `La pregunta ${cual} es demasiado larga.`;
  if (pregunta.opciones.length > MAX_OPCIONES) return `La pregunta ${cual} tiene más de ${MAX_OPCIONES} opciones.`;

  const vistas = new Set<string>();
  for (const opcion of pregunta.opciones) {
    const clave = claveDeCampo(opcion);
    if (!opcion || !clave) return `La pregunta ${cual} tiene una opción vacía.`;
    if (opcion.length > LARGO_MAX_OPCION) return `Una opción de la pregunta ${cual} es demasiado larga.`;
    if (vistas.has(clave)) return `La pregunta ${cual} tiene la opción ${JSON.stringify(opcion)} repetida.`;
    vistas.add(clave);
  }

  if (!pregunta.textoLibre && pregunta.opciones.length === 0) {
    return `La pregunta ${cual} no tiene opciones: agregá alguna o dejá que el cliente responda con sus palabras.`;
  }
  if (!pregunta.textoLibre && pregunta.opciones.length === 1) {
    return `La pregunta ${cual} tiene una sola opción y no hay nada para elegir: agregá otra o dejá que el cliente escriba otra respuesta.`;
  }
  return null;
}

/**
 * Valida y normaliza lo que manda la pantalla. Devuelve el motivo del rechazo
 * en castellano (va tal cual en el 400). Ninguna pregunta es válido; el orden
 * es el de carga. Sin `sobre`, la pregunta es sobre lo que el cliente pide.
 */
export function normalizarSolicitud(entrada: SolicitudEntrada): { solicitud: SolicitudADemanda } | { error: string } {
  if (entrada.preguntas.length > MAX_PREGUNTAS) return { error: `Un producto puede tener hasta ${MAX_PREGUNTAS} preguntas.` };

  const preguntas: PreguntaSolicitud[] = [];
  const vistas = new Set<string>();
  for (const [indice, cruda] of entrada.preguntas.entries()) {
    const sobre = cruda.sobre ?? 'solicita';
    if (!esSobre(sobre)) return { error: `La pregunta ${indice + 1} no dice si es sobre lo que tiene o lo que pide.` };
    const pregunta: PreguntaSolicitud = {
      texto: enUnaLinea(cruda.texto),
      sobre,
      opciones: (cruda.opciones ?? []).map(enUnaLinea),
      textoLibre: cruda.textoLibre === true,
      obligatoria: cruda.obligatoria === true,
    };
    const problema = problemaDePregunta(pregunta, indice + 1);
    if (problema) return { error: problema };
    const clave = claveDeCampo(pregunta.texto);
    if (vistas.has(clave)) return { error: `La pregunta ${JSON.stringify(pregunta.texto)} está repetida.` };
    vistas.add(clave);
    preguntas.push(pregunta);
  }

  return { solicitud: { preguntas } };
}

/**
 * Los materiales del producto, en el orden de carga: en una línea, sin vacíos
 * ni repetidos (sin tildes ni mayúsculas, como las opciones).
 */
export function normalizarMateriales(lista: readonly string[]): { materiales: string[] } | { error: string } {
  const materiales: string[] = [];
  const vistos = new Set<string>();
  for (const crudo of lista) {
    const material = enUnaLinea(crudo);
    const clave = claveDeCampo(material);
    if (!material || !clave || vistos.has(clave)) continue;
    if (material.length > LARGO_MAX_MATERIAL) return { error: `El material ${JSON.stringify(material)} es demasiado largo.` };
    vistos.add(clave);
    materiales.push(material);
  }
  if (materiales.length > MAX_MATERIALES) return { error: `Un producto puede tener hasta ${MAX_MATERIALES} materiales.` };
  return { materiales };
}

/**
 * `Producto.solicitud` es Json: se valida la forma al leer en vez de castear.
 * Lo que no cierra vuelve como `null` (= no se hace a medida), que es el caso
 * en el que el asistente no le pregunta nada de más al cliente.
 */
export function leerSolicitud(json: unknown): SolicitudADemanda | null {
  if (!esObjeto(json) || !Array.isArray(json.preguntas)) return null;
  const preguntas = json.preguntas.flatMap((item) => {
    if (!esObjeto(item) || typeof item.texto !== 'string' || typeof item.sobre !== 'string') return [];
    const opciones = Array.isArray(item.opciones) ? item.opciones.filter((o): o is string => typeof o === 'string') : [];
    return [
      {
        texto: item.texto,
        sobre: item.sobre,
        opciones,
        textoLibre: item.textoLibre === true,
        obligatoria: item.obligatoria === true,
      },
    ];
  });
  const resultado = normalizarSolicitud({ preguntas });
  return 'solicitud' in resultado ? resultado.solicitud : null;
}

/**
 * Las respuestas del cliente contra la configuración: una solicitud no está
 * completa mientras falte alguna pregunta obligatoria. Las preguntas se
 * emparejan por texto sin tildes ni mayúsculas, igual que los datos del
 * cliente; una pregunta con opciones y sin texto libre sólo acepta una de sus
 * opciones (y queda escrita como la cargó el dueño). Lo que no se preguntó se
 * descarta.
 */
export function validarRespuestasSolicitud(config: SolicitudADemanda, respuestas: unknown): ResultadoRespuestas {
  const recibidas = new Map<string, string>();
  for (const dato of Array.isArray(respuestas) ? respuestas : []) {
    if (!esObjeto(dato) || typeof dato.pregunta !== 'string' || typeof dato.respuesta !== 'string') continue;
    const limpia = enUnaLinea(dato.respuesta).slice(0, LARGO_MAX_RESPUESTA);
    if (limpia) recibidas.set(claveDeCampo(dato.pregunta), limpia);
  }

  const validas: RespuestaSolicitud[] = [];
  const sinRespuesta: string[] = [];
  const fueraDeOpciones: PreguntaSolicitud[] = [];
  for (const pregunta of config.preguntas) {
    const valor = recibidas.get(claveDeCampo(pregunta.texto));
    if (valor === undefined) {
      if (pregunta.obligatoria) sinRespuesta.push(pregunta.texto);
      continue;
    }
    const opcion = pregunta.opciones.find((o) => claveDeCampo(o) === claveDeCampo(valor));
    if (pregunta.opciones.length > 0 && !opcion && !pregunta.textoLibre) {
      // Una opcional mal contestada no traba la solicitud: se descarta.
      if (pregunta.obligatoria) fueraDeOpciones.push(pregunta);
      continue;
    }
    validas.push({ pregunta: pregunta.texto, respuesta: opcion ?? valor });
  }

  if (sinRespuesta.length > 0 || fueraDeOpciones.length > 0) {
    const partes = [
      ...(sinRespuesta.length > 0 ? [`faltan ${sinRespuesta.map((t) => JSON.stringify(t)).join(', ')}`] : []),
      ...fueraDeOpciones.map(
        (p) => `${JSON.stringify(p.texto)} sólo admite ${p.opciones.map((o) => JSON.stringify(o)).join(', ')}`,
      ),
    ];
    return {
      ok: false,
      motivo: `La solicitud todavía no está completa: ${partes.join('; ')}.`,
      faltantes: [...sinRespuesta, ...fueraDeOpciones.map((p) => p.texto)],
    };
  }
  return { ok: true, respuestas: validas };
}

/**
 * Qué formulario de producto tiene la cuenta depende de cómo vende (se elige
 * en el registro y no cambia): con stock, variantes con precio y stock; a
 * pedido, un producto a medida con sus preguntas (pueden ser ninguna, pero la
 * solicitud viene: es lo que lo marca a medida), sus materiales y, si quiere,
 * un precio "desde", sin variantes ni descuento. Lo que no corresponde es un
 * 400. `undefined` es "no vino" (no toca lo guardado); `null`, "sin".
 */
export function problemaSegunModalidad(
  modalidad: ModalidadVenta,
  producto: { variantes: number; descuento: unknown; solicitud: unknown; precioReferencia: unknown; materiales?: unknown },
): string | null {
  const presente = (valor: unknown) => valor !== undefined && valor !== null;
  if (modalidad === 'stock') {
    if (producto.variantes === 0) return 'Poné el precio del producto.';
    const conMateriales = Array.isArray(producto.materiales) && producto.materiales.length > 0;
    if (presente(producto.solicitud) || presente(producto.precioReferencia) || conMateriales) {
      return 'Tu cuenta vende con stock: los productos no llevan preguntas ni materiales para presupuestar.';
    }
    return null;
  }
  if (producto.variantes > 0) return 'Tu cuenta vende a pedido: los productos no llevan variantes ni stock.';
  if (presente(producto.descuento)) return 'Tu cuenta vende a pedido: los productos no llevan descuento.';
  if (!presente(producto.solicitud)) return 'Faltan las preguntas para hacer del producto (pueden ser ninguna).';
  return null;
}
