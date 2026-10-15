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
 * Cada pregunta dice si describe lo que el cliente ya tiene (las medidas del
 * hueco, el modelo de su auto) o lo que pide (color, material). Sin opciones
 * es de respuesta escrita; con opciones, `textoLibre` deja contestar otra cosa
 * cuando ninguna le sirve.
 */
import { claveDeCampo } from './datos-cliente.rules.js';

export const SOBRE_PREGUNTA = ['tiene', 'solicita'] as const;
export type SobrePregunta = (typeof SOBRE_PREGUNTA)[number];

export const MAX_PREGUNTAS = 15;
export const MAX_OPCIONES = 12;
export const LARGO_MIN_PREGUNTA = 3;
export const LARGO_MAX_PREGUNTA = 120;
export const LARGO_MAX_OPCION = 60;
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
    sobre: string;
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

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esSobre(valor: unknown): valor is SobrePregunta {
  return typeof valor === 'string' && (SOBRE_PREGUNTA as readonly string[]).includes(valor);
}

/** Un texto del dueño en una sola línea: un salto de línea en el prompt se lee como otra regla. */
function enUnaLinea(texto: string): string {
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
 * en castellano (va tal cual en el 400). Las preguntas quedan primero las de
 * lo que el cliente tiene y después las de lo que pide, cada grupo en el
 * orden en que el dueño las cargó: es el orden en que conviene preguntarlas.
 */
export function normalizarSolicitud(entrada: SolicitudEntrada): { solicitud: SolicitudADemanda } | { error: string } {
  if (entrada.preguntas.length === 0) return { error: 'Agregá al menos una pregunta para el pedido a medida.' };
  if (entrada.preguntas.length > MAX_PREGUNTAS) return { error: `Un producto puede tener hasta ${MAX_PREGUNTAS} preguntas.` };

  const preguntas: PreguntaSolicitud[] = [];
  const vistas = new Set<string>();
  for (const [indice, cruda] of entrada.preguntas.entries()) {
    if (!esSobre(cruda.sobre)) return { error: `La pregunta ${indice + 1} no dice si es sobre lo que tiene o lo que pide.` };
    const pregunta: PreguntaSolicitud = {
      texto: enUnaLinea(cruda.texto),
      sobre: cruda.sobre,
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

  return {
    solicitud: {
      preguntas: [...preguntas.filter((p) => p.sobre === 'tiene'), ...preguntas.filter((p) => p.sobre === 'solicita')],
    },
  };
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
