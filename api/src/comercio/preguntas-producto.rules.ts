/**
 * Preguntas de un producto: lo que el asistente le pregunta al cliente al
 * pedirlo (talle, color, un nombre para estampar). Cada una es de opciones
 * (elige una) o de texto libre. No cambian el precio: el total sale siempre
 * del precio del producto.
 *
 * Se guardan en `Producto.preguntasPedido` y las respuestas de un pedido quedan
 * copiadas en `ItemVenta.respuestas`, así que cambiar o borrar una pregunta
 * después no toca los pedidos ya hechos.
 */
import { normalizarTexto } from './catalogo.rules.js';

export const MAX_PREGUNTAS_POR_PRODUCTO = 5;
export const MIN_OPCIONES = 2;
export const MAX_OPCIONES = 12;
export const LARGOS_PREGUNTA = { texto: 120, opcion: 40, respuesta: 200 } as const;

export const TIPOS_PREGUNTA = ['opciones', 'texto'] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];

export type PreguntaProducto = {
  texto: string;
  tipo: TipoPregunta;
  /** Vacío en las de texto libre. */
  opciones: string[];
  obligatoria: boolean;
};

/** Lo que guarda un renglón del pedido: la pregunta tal como estaba al pedir y lo que contestó el cliente. */
export type RespuestaGuardada = { pregunta: string; respuesta: string };

/** Lo que manda el modelo: el número (desde 1) de la pregunta en la lista del producto y lo que dijo el cliente. */
export type RespuestaDelModelo = { productoId: string; pregunta: number; respuesta: string };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

type Resultado<T> = { valor: T } | { error: string };

/** Espacios colapsados y sin bordes: como se guarda y se compara un texto del dueño. */
function limpiar(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

/** Las opciones de una pregunta de opciones: sin vacías ni repetidas, dentro de los topes. */
function normalizarOpciones(crudas: unknown, lugar: string): Resultado<string[]> {
  if (!Array.isArray(crudas)) return { error: `${lugar} necesita opciones.` };
  const opciones: string[] = [];
  const vistas = new Set<string>();
  for (const cruda of crudas) {
    if (typeof cruda !== 'string') return { error: `${lugar} tiene una opción inválida.` };
    const opcion = limpiar(cruda);
    if (!opcion) continue;
    if (opcion.length > LARGOS_PREGUNTA.opcion) {
      return { error: `Una opción de ${lugar.toLowerCase()} tiene más de ${LARGOS_PREGUNTA.opcion} caracteres.` };
    }
    const clave = normalizarTexto(opcion);
    if (vistas.has(clave)) return { error: `${lugar} tiene una opción repetida: ${opcion}.` };
    vistas.add(clave);
    opciones.push(opcion);
  }
  if (opciones.length < MIN_OPCIONES) return { error: `${lugar} necesita al menos ${MIN_OPCIONES} opciones.` };
  if (opciones.length > MAX_OPCIONES) return { error: `${lugar} puede tener hasta ${MAX_OPCIONES} opciones.` };
  return { valor: opciones };
}

/** Una pregunta del formulario; `textos` junta las ya vistas para no repetirlas. */
function normalizarPregunta(cruda: unknown, lugar: string, textos: Set<string>): Resultado<PreguntaProducto> {
  if (!esObjeto(cruda) || typeof cruda.texto !== 'string') return { error: `${lugar} no es válida.` };
  const texto = limpiar(cruda.texto);
  if (!texto) return { error: `${lugar} está vacía.` };
  if (texto.length > LARGOS_PREGUNTA.texto) return { error: `${lugar} tiene más de ${LARGOS_PREGUNTA.texto} caracteres.` };
  const claveTexto = normalizarTexto(texto);
  if (textos.has(claveTexto)) return { error: `${lugar} está repetida.` };
  textos.add(claveTexto);
  if (!(TIPOS_PREGUNTA as readonly unknown[]).includes(cruda.tipo)) return { error: `${lugar} tiene un tipo inválido.` };
  const tipo = cruda.tipo as TipoPregunta;
  const obligatoria = cruda.obligatoria === true;
  if (tipo !== 'opciones') return { valor: { texto, tipo, opciones: [], obligatoria } };
  const opciones = normalizarOpciones(cruda.opciones, lugar);
  return 'error' in opciones ? opciones : { valor: { texto, tipo, opciones: opciones.valor, obligatoria } };
}

/** Las preguntas del formulario, validadas; null o lista vacía = el producto no pregunta nada. */
export function normalizarPreguntas(entrada: unknown): { preguntas: PreguntaProducto[] | null } | { error: string } {
  if (entrada === null || entrada === undefined) return { preguntas: null };
  if (!Array.isArray(entrada)) return { error: 'Las preguntas no son válidas.' };
  if (entrada.length === 0) return { preguntas: null };
  if (entrada.length > MAX_PREGUNTAS_POR_PRODUCTO) {
    return { error: `Un producto puede tener hasta ${MAX_PREGUNTAS_POR_PRODUCTO} preguntas.` };
  }
  const preguntas: PreguntaProducto[] = [];
  const textos = new Set<string>();
  for (const [indice, cruda] of entrada.entries()) {
    const pregunta = normalizarPregunta(cruda, `La pregunta ${indice + 1}`, textos);
    if ('error' in pregunta) return pregunta;
    preguntas.push(pregunta.valor);
  }
  return { preguntas };
}

/** Lo guardado en la base, sin confiar en su forma (null si no hay o está dañado). */
export function leerPreguntas(guardado: unknown): PreguntaProducto[] | null {
  const resultado = normalizarPreguntas(guardado);
  return 'error' in resultado ? null : resultado.preguntas;
}

/** Las respuestas guardadas en un renglón, sin confiar en su forma. */
export function leerRespuestas(guardado: unknown): RespuestaGuardada[] {
  if (!Array.isArray(guardado)) return [];
  return guardado.flatMap((dato) =>
    esObjeto(dato) && typeof dato.pregunta === 'string' && typeof dato.respuesta === 'string'
      ? [{ pregunta: dato.pregunta, respuesta: dato.respuesta }]
      : [],
  );
}

/** Las preguntas de un producto como las lee el modelo: numeradas, con sus opciones y si se pueden saltear. */
export function describirPreguntas(preguntas: PreguntaProducto[]): string {
  return preguntas
    .map((pregunta, indice) => {
      const forma =
        pregunta.tipo === 'opciones'
          ? `opciones: ${pregunta.opciones.map((opcion) => JSON.stringify(opcion)).join(' / ')}`
          : 'respuesta libre';
      return `${indice + 1}) ${JSON.stringify(pregunta.texto)} (${forma}; ${pregunta.obligatoria ? 'obligatoria' : 'opcional'})`;
    })
    .join(' · ');
}

export type ProductoConPreguntas = { id: string; nombre: string; preguntas: PreguntaProducto[] | null };

/**
 * Las respuestas del pedido contra las preguntas que tiene hoy cada producto.
 * Devuelve lo que se guarda por producto (la pregunta tal cual está en la
 * base y la opción elegida con el texto del dueño, no con el del modelo) o el
 * motivo, listo para que el asistente lo corrija preguntándole al cliente.
 */
export function validarRespuestas(
  productos: ProductoConPreguntas[],
  respuestas: RespuestaDelModelo[],
): { porProducto: Map<string, RespuestaGuardada[]> } | { error: string } {
  const dadas = new Map<string, Map<number, string>>();
  for (const respuesta of respuestas) {
    const producto = productos.find((candidato) => candidato.id === respuesta.productoId);
    if (!producto) return { error: 'Mandaste respuestas de un producto que no está en el pedido.' };
    const pregunta = producto.preguntas?.[respuesta.pregunta - 1];
    if (!pregunta) {
      return { error: `${JSON.stringify(producto.nombre)} no tiene la pregunta número ${respuesta.pregunta}.` };
    }
    const texto = limpiar(String(respuesta.respuesta ?? ''));
    if (!texto) continue;
    const valor = valorDeRespuesta(producto, pregunta, texto);
    if ('error' in valor) return valor;
    const delProducto = dadas.get(producto.id) ?? new Map<number, string>();
    delProducto.set(respuesta.pregunta, valor.valor);
    dadas.set(producto.id, delProducto);
  }

  const porProducto = new Map<string, RespuestaGuardada[]>();
  for (const producto of productos) {
    const guardadas = guardadasDe(producto, dadas.get(producto.id) ?? new Map<number, string>());
    if ('error' in guardadas) return guardadas;
    porProducto.set(producto.id, guardadas.valor);
  }
  return { porProducto };
}

/** Lo que se guarda de una respuesta: la opción con el texto del dueño, o el texto libre dentro del largo. */
function valorDeRespuesta(producto: ProductoConPreguntas, pregunta: PreguntaProducto, texto: string): Resultado<string> {
  if (pregunta.tipo !== 'opciones') {
    return texto.length > LARGOS_PREGUNTA.respuesta
      ? { error: `La respuesta a ${JSON.stringify(pregunta.texto)} es muy larga (máximo ${LARGOS_PREGUNTA.respuesta} caracteres).` }
      : { valor: texto };
  }
  const elegida = pregunta.opciones.find((opcion) => normalizarTexto(opcion) === normalizarTexto(texto));
  if (elegida) return { valor: elegida };
  return {
    error:
      `${JSON.stringify(texto)} no es una opción de ${JSON.stringify(pregunta.texto)} ` +
      `(${JSON.stringify(producto.nombre)}). Las opciones son: ${pregunta.opciones.join(', ')}. ` +
      'Preguntale al cliente cuál prefiere.',
  };
}

/** Las respuestas de un producto en el orden de sus preguntas, o la obligatoria que falta. */
function guardadasDe(producto: ProductoConPreguntas, dadas: Map<number, string>): Resultado<RespuestaGuardada[]> {
  const guardadas: RespuestaGuardada[] = [];
  for (const [indice, pregunta] of (producto.preguntas ?? []).entries()) {
    const valor = dadas.get(indice + 1);
    if (valor !== undefined) {
      guardadas.push({ pregunta: pregunta.texto, respuesta: valor });
      continue;
    }
    if (pregunta.obligatoria) {
      const opciones = pregunta.tipo === 'opciones' ? ` (opciones: ${pregunta.opciones.join(', ')})` : '';
      return {
        error:
          `Falta preguntarle al cliente ${JSON.stringify(pregunta.texto)} por ${JSON.stringify(producto.nombre)}` +
          `${opciones}: es obligatoria. Preguntáselo y volvé a crear el pedido con su respuesta.`,
      };
    }
  }
  return { valor: guardadas };
}
