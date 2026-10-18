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
import { PATRON_VARIABLE } from './formula.rules.js';

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
export const LARGO_MAX_UNIDAD_PREGUNTA = 15;
/** Lo más grande que puede contestar el cliente en una pregunta de número. */
export const NUMERO_MAX_RESPUESTA = 1_000_000;

/**
 * Una pregunta de número (LAU-26): su respuesta es un dato de la receta de
 * cotización ("ancho", "alto"), con la unidad en que se la pregunta y un
 * rango opcional. No tiene opciones: se contesta con un número.
 */
export type NumeroDePregunta = { variable: string; unidad: string; min: number | null; max: number | null };

export type PreguntaSolicitud = {
  texto: string;
  sobre: SobrePregunta;
  opciones: string[];
  textoLibre: boolean;
  obligatoria: boolean;
  /** Sólo en las de número. */
  numero?: NumeroDePregunta;
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
    numero?: { variable?: string; unidad?: string; min?: number | null; max?: number | null } | null;
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

  if (pregunta.numero) {
    const { variable, unidad, min, max } = pregunta.numero;
    if (pregunta.opciones.length > 0) return `La pregunta ${cual} es de número: no lleva opciones.`;
    if (!PATRON_VARIABLE.test(variable)) {
      return `El dato de la pregunta ${cual} tiene que ser una palabra sin espacios ni tildes (por ejemplo "ancho").`;
    }
    if (unidad.length > LARGO_MAX_UNIDAD_PREGUNTA) return `La unidad de la pregunta ${cual} es demasiado larga.`;
    for (const limite of [min, max]) {
      if (limite !== null && (!Number.isFinite(limite) || limite < 0 || limite > NUMERO_MAX_RESPUESTA)) {
        return `El rango de la pregunta ${cual} no es válido.`;
      }
    }
    if (min !== null && max !== null && min > max) return `En la pregunta ${cual} el mínimo es mayor que el máximo.`;
    return null;
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
  const variables = new Set<string>();
  for (const [indice, cruda] of entrada.preguntas.entries()) {
    const sobre = cruda.sobre ?? 'solicita';
    if (!esSobre(sobre)) return { error: `La pregunta ${indice + 1} no dice si es sobre lo que tiene o lo que pide.` };
    const numero = cruda.numero
      ? {
          variable: enUnaLinea(cruda.numero.variable ?? '').toLowerCase(),
          unidad: enUnaLinea(cruda.numero.unidad ?? ''),
          min: typeof cruda.numero.min === 'number' ? cruda.numero.min : null,
          max: typeof cruda.numero.max === 'number' ? cruda.numero.max : null,
        }
      : undefined;
    const pregunta: PreguntaSolicitud = {
      texto: enUnaLinea(cruda.texto),
      sobre,
      opciones: (cruda.opciones ?? []).map(enUnaLinea),
      // Una de número se contesta escribiendo: no hay opciones para elegir.
      textoLibre: numero ? true : cruda.textoLibre === true,
      obligatoria: cruda.obligatoria === true,
      ...(numero ? { numero } : {}),
    };
    const problema = problemaDePregunta(pregunta, indice + 1);
    if (problema) return { error: problema };
    const clave = claveDeCampo(pregunta.texto);
    if (vistas.has(clave)) return { error: `La pregunta ${JSON.stringify(pregunta.texto)} está repetida.` };
    vistas.add(clave);
    if (numero) {
      if (variables.has(numero.variable)) return { error: `Hay dos preguntas con el dato "${numero.variable}".` };
      variables.add(numero.variable);
    }
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
    const numero = esObjeto(item.numero) && typeof item.numero.variable === 'string' ? item.numero : null;
    return [
      {
        texto: item.texto,
        sobre: item.sobre,
        opciones,
        textoLibre: item.textoLibre === true,
        obligatoria: item.obligatoria === true,
        ...(numero
          ? {
              numero: {
                variable: numero.variable as string,
                unidad: typeof numero.unidad === 'string' ? numero.unidad : '',
                min: typeof numero.min === 'number' ? numero.min : null,
                max: typeof numero.max === 'number' ? numero.max : null,
              },
            }
          : {}),
      },
    ];
  });
  const resultado = normalizarSolicitud({ preguntas });
  return 'solicitud' in resultado ? resultado.solicitud : null;
}

/**
 * Un número como lo escribe alguien: "120", "1,5", "1.5", "120 cm". Sin
 * separador de miles (en una medida "1.200" sería ambiguo). null si no hay
 * un número claro o es negativo o enorme.
 */
export function leerNumero(texto: string): number | null {
  const encontrado = /^\s*(\d+(?:[.,]\d+)?)\s*[a-zA-Z²³°%"']*\s*$/.exec(texto);
  if (!encontrado) return null;
  const numero = Number(encontrado[1].replace(',', '.'));
  return Number.isFinite(numero) && numero <= NUMERO_MAX_RESPUESTA ? numero : null;
}

/** Los datos numéricos de un producto, para las fórmulas de su receta. */
export function variablesDeSolicitud(solicitud: SolicitudADemanda | null): string[] {
  return (solicitud?.preguntas ?? []).flatMap((pregunta) => (pregunta.numero ? [pregunta.numero.variable] : []));
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
  const fueraDeRango: Array<{ pregunta: PreguntaSolicitud; unidad: string; min: number | null; max: number | null }> = [];
  for (const pregunta of config.preguntas) {
    const valor = recibidas.get(claveDeCampo(pregunta.texto));
    if (valor === undefined) {
      if (pregunta.obligatoria) sinRespuesta.push(pregunta.texto);
      continue;
    }
    if (pregunta.numero) {
      const numero = leerNumero(valor);
      const { min, max, unidad } = pregunta.numero;
      if (numero === null || (min !== null && numero < min) || (max !== null && numero > max)) {
        if (pregunta.obligatoria) fueraDeRango.push({ pregunta, unidad, min, max });
        continue;
      }
      validas.push({ pregunta: pregunta.texto, respuesta: String(numero) });
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

  if (sinRespuesta.length > 0 || fueraDeOpciones.length > 0 || fueraDeRango.length > 0) {
    const partes = [
      ...(sinRespuesta.length > 0 ? [`faltan ${sinRespuesta.map((t) => JSON.stringify(t)).join(', ')}`] : []),
      ...fueraDeOpciones.map(
        (p) => `${JSON.stringify(p.texto)} sólo admite ${p.opciones.map((o) => JSON.stringify(o)).join(', ')}`,
      ),
      ...fueraDeRango.map(({ pregunta, unidad, min, max }) => {
        const rango =
          min !== null && max !== null ? ` entre ${min} y ${max}` : min !== null ? ` de ${min} o más` : max !== null ? ` de hasta ${max}` : '';
        return `${JSON.stringify(pregunta.texto)} tiene que ser un número${rango}${unidad ? ` (en ${unidad})` : ''}`;
      }),
    ];
    return {
      ok: false,
      motivo: `La solicitud todavía no está completa: ${partes.join('; ')}.`,
      faltantes: [...sinRespuesta, ...fueraDeOpciones.map((p) => p.texto), ...fueraDeRango.map((f) => f.pregunta.texto)],
    };
  }
  return { ok: true, respuestas: validas };
}

/** Lo más que puede pedir un cliente de una variante fija, como una línea de un pedido con stock. */
export const MAX_CANTIDAD_VARIANTE_FIJA = 50;

/**
 * Qué formulario de producto tiene la cuenta depende de cómo vende (se elige
 * en el registro y no cambia): con stock, variantes con precio y stock; a
 * pedido, un producto a medida con sus preguntas (pueden ser ninguna, pero la
 * solicitud viene: es lo que lo marca a medida), sus materiales, si quiere un
 * precio "desde" y, también si quiere, variantes fijas: versiones con precio
 * cerrado que el cliente pide tal cual, sin stock ni descuento. Lo que no
 * corresponde es un 400. `undefined` es "no vino" (no toca lo guardado);
 * `null`, "sin".
 */
export function problemaSegunModalidad(
  modalidad: ModalidadVenta,
  producto: {
    variantes: number;
    descuento: unknown;
    solicitud: unknown;
    precioReferencia: unknown;
    materiales?: unknown;
    /** Alguna variante trae stock o stock mínimo. */
    conStock?: boolean;
  },
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
  if (producto.conStock) return 'Tu cuenta vende a pedido: las variantes tienen precio fijo pero no llevan stock.';
  if (presente(producto.descuento)) return 'Tu cuenta vende a pedido: los productos no llevan descuento.';
  if (!presente(producto.solicitud)) return 'Faltan las preguntas para hacer del producto (pueden ser ninguna).';
  return null;
}
