/**
 * Mensajes que el dueño puede escribir a mano en vez de dejar que los redacte
 * el modelo: el saludo, el link de pago, "no hay más productos", el horario
 * ocupado y el pago recibido. Viven en `Agent.mensajes` (Json) y se aplican en
 * tiempo de ejecución, así que no hace falta regenerar el system prompt.
 *
 * Todo acá es puro (sin base ni red), igual que agenda-rules.ts: lo usan el
 * endpoint que los guarda y los nodos del grafo que los mandan.
 *
 * Lo que cambia es cómo se dice, nunca qué se permite: horarios, stock y
 * precios los siguen validando las reglas en código.
 */
import type { Agent } from '../generated/prisma/client.js';
import type { TipoAsistente } from './agent-catalog.js';

export const CLAVES_MENSAJE = ['saludo', 'linkPago', 'sinProductos', 'pagoAprobado', 'horarioOcupado'] as const;
export type ClaveMensaje = (typeof CLAVES_MENSAJE)[number];

export const MODOS_MENSAJE = ['auto', 'propio'] as const;
export type ModoMensaje = (typeof MODOS_MENSAJE)[number];

export type MensajeConfigurado = { modo: ModoMensaje; texto: string };
export type MensajesAgente = Partial<Record<ClaveMensaje, MensajeConfigurado>>;

/** Lo que entra cómodo en un mensaje de WhatsApp sin volverse un mail. */
export const MAX_CARACTERES_MENSAJE = 400;

type Definicion = {
  /** Datos que se completan solos: `{nombre}` en el texto. */
  variables: readonly string[];
  /** Sin estos el mensaje no sirve (sin `{link}` el cliente no puede pagar). */
  obligatorias: readonly string[];
};

/** Qué mensajes se pueden personalizar en cada tipo de asistente, y con qué datos. */
export const MENSAJES_POR_TIPO: Record<TipoAsistente, Partial<Record<ClaveMensaje, Definicion>>> = {
  agenda: {
    saludo: { variables: ['asistente', 'titular'], obligatorias: [] },
    horarioOcupado: { variables: ['horario_pedido', 'sugerencia', 'titular'], obligatorias: [] },
  },
  ventas: {
    saludo: { variables: ['asistente', 'negocio'], obligatorias: [] },
    linkPago: { variables: ['nombre', 'detalle', 'total', 'link', 'vence'], obligatorias: ['link'] },
    sinProductos: { variables: ['busqueda', 'negocio'], obligatorias: [] },
    pagoAprobado: { variables: ['nombre', 'total', 'detalle', 'negocio'], obligatorias: [] },
  },
};

const VARIABLE = /\{(\w+)\}/g;

export function variablesUsadas(texto: string): string[] {
  return [...texto.matchAll(VARIABLE)].map((coincidencia) => coincidencia[1]);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Valida y normaliza lo que manda la pantalla. Devuelve el motivo del rechazo
 * en castellano, listo para mostrarle al dueño, o los mensajes a guardar.
 */
export function normalizarMensajes(
  tipo: TipoAsistente,
  entrada: Record<string, { modo: string; texto: string }>,
): { mensajes: MensajesAgente } | { error: string } {
  const catalogo = MENSAJES_POR_TIPO[tipo];
  const mensajes: MensajesAgente = {};
  for (const [clave, valor] of Object.entries(entrada)) {
    const definicion = (CLAVES_MENSAJE as readonly string[]).includes(clave) ? catalogo[clave as ClaveMensaje] : undefined;
    if (!definicion) return { error: `Tu asistente no tiene un mensaje "${clave}" para personalizar.` };
    if (!(MODOS_MENSAJE as readonly string[]).includes(valor.modo)) return { error: 'El modo del mensaje no es válido.' };
    const texto = valor.texto.replace(/\r\n?/g, '\n').trim();
    if (texto.length > MAX_CARACTERES_MENSAJE) {
      return { error: `Un mensaje puede tener como mucho ${MAX_CARACTERES_MENSAJE} caracteres.` };
    }
    if (valor.modo === 'propio') {
      if (!texto) return { error: 'Escribí el mensaje, o volvé a dejarlo en automático.' };
      const usadas = variablesUsadas(texto);
      const desconocida = usadas.find((variable) => !definicion.variables.includes(variable));
      if (desconocida) return { error: `{${desconocida}} no es un dato que se pueda completar en ese mensaje.` };
      const faltante = definicion.obligatorias.find((variable) => !usadas.includes(variable));
      if (faltante) return { error: `Al mensaje le falta {${faltante}}.` };
    }
    mensajes[clave as ClaveMensaje] = { modo: valor.modo as ModoMensaje, texto };
  }
  return { mensajes };
}

/**
 * `Agent.mensajes` es Json: se valida la forma al leer en vez de castear, como
 * leerTiposEvento. Lo que no tiene la forma esperada se ignora (queda en auto).
 */
export function leerMensajes(agent: Pick<Agent, 'mensajes'>): MensajesAgente {
  if (!esObjeto(agent.mensajes)) return {};
  const mensajes: MensajesAgente = {};
  for (const clave of CLAVES_MENSAJE) {
    const valor = agent.mensajes[clave];
    if (!esObjeto(valor) || typeof valor.texto !== 'string') continue;
    if (valor.modo !== 'auto' && valor.modo !== 'propio') continue;
    mensajes[clave] = { modo: valor.modo, texto: valor.texto };
  }
  return mensajes;
}

/** El texto del dueño para esa clave, o null si la dejó en automático. */
export function mensajePropio(agent: Pick<Agent, 'mensajes'>, clave: ClaveMensaje): string | null {
  const mensaje = leerMensajes(agent)[clave];
  return mensaje?.modo === 'propio' && mensaje.texto.trim() ? mensaje.texto : null;
}

/**
 * Reemplaza cada `{dato}` por su valor. Lo que no está en `datos` queda como
 * está. Si un dato vino vacío (un cliente sin nombre) acomoda la puntuación
 * que queda colgando: "¡Listo, {nombre}!" → "¡Listo!".
 */
export function completarPlantilla(texto: string, datos: Record<string, string>): string {
  let huboVacio = false;
  const completo = texto.replace(VARIABLE, (todo, clave: string) => {
    const valor = datos[clave];
    if (valor === undefined) return todo;
    const limpio = limpiarDato(valor);
    if (!limpio) huboVacio = true;
    return limpio;
  });
  const final = huboVacio
    ? completo
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?, ?([!?.,])/g, '$1')
        .replace(/ ([!?.,])/g, '$1')
        .trim()
    : completo;
  return final.slice(0, MAX_CARACTERES_COMPLETADO);
}

/** Tope del mensaje ya completado: los datos (un pedido largo, un link) lo estiran. */
export const MAX_CARACTERES_COMPLETADO = 1000;

/** Tope de cada dato que se mete en un mensaje: lo escribe el cliente o sale de la base. */
export const MAX_CARACTERES_DATO = 300;

const MARCADOR = /mandale al cliente exactamente/gi;

/**
 * Saca la frase con la que el código le pide al modelo mandar algo tal cual:
 * un cliente que la escribe en su nombre o en lo que busca no puede hacer que
 * el bot repita lo que él quiera.
 */
export function neutralizarMarcador(texto: string): string {
  return texto.replace(MARCADOR, '');
}

/** Un dato listo para entrar en un mensaje: una línea, acotado y sin el marcador. */
function limpiarDato(valor: string): string {
  return neutralizarMarcador(valor).replace(/\s+/g, ' ').trim().slice(0, MAX_CARACTERES_DATO);
}

/** Si el dueño escribió algún mensaje propio: sin eso, la regla de "tal cual" ni aparece. */
export function tieneMensajesPropios(agent: Pick<Agent, 'mensajes'>): boolean {
  return Object.values(leerMensajes(agent)).some((mensaje) => mensaje.modo === 'propio' && mensaje.texto.trim());
}

/**
 * Cómo le llega al modelo un mensaje que tiene que mandar tal cual. El texto
 * va con `JSON.stringify`, igual que los otros campos libres del dueño, para
 * que se lea como dato y no como instrucciones.
 */
export function instruccionMandarTalCual(texto: string): string {
  return `Mandale al cliente exactamente este mensaje, sin agregarle ni sacarle nada: ${JSON.stringify(texto)}`;
}

/**
 * La regla de estilo que acompaña a instruccionMandarTalCual: sin ella, el
 * "una o dos frases" del bloque de estilo le gana al texto del dueño. Sólo se
 * suma con `reglaDeMensajesPropios`, cuando el dueño escribió alguno.
 */
export const REGLA_MENSAJE_TAL_CUAL =
  '\n- Si un resultado te dice "Mandale al cliente exactamente este mensaje", mandá ese texto tal cual, sin las ' +
  'comillas y sin agregarle ni sacarle nada: eso está por encima de las otras reglas de estilo.';

export function reglaDeMensajesPropios(agent: Pick<Agent, 'mensajes'>): string {
  return tieneMensajesPropios(agent) ? REGLA_MENSAJE_TAL_CUAL : '';
}
