/**
 * Productos a medida (LAU-22) del lado de la pantalla: las preguntas que el
 * asistente le hace al cliente para que el comercio pueda presupuestar. Copia
 * a mano de las reglas de api/src/comercio/solicitud.rules.ts (si no
 * coinciden, la API responde 400 con el motivo).
 */

export type SobrePregunta = "tiene" | "solicita";

export const MAX_PREGUNTAS = 15;
export const MAX_OPCIONES = 12;
export const LARGO_MIN_PREGUNTA = 3;
export const LARGO_MAX_PREGUNTA = 120;
export const LARGO_MAX_OPCION = 60;
export const MAX_MATERIALES = 20;
export const LARGO_MAX_MATERIAL = 60;
export const LARGO_MAX_UNIDAD_PREGUNTA = 15;
export const NUMERO_MAX_RESPUESTA = 1_000_000;
/** Nombre de un dato de número: lo que aparece en los botones de la receta (igual que `PATRON_VARIABLE`). */
export const PATRON_VARIABLE = /^[a-z_][a-z0-9_]{0,29}$/;

/** Una pregunta de número (LAU-26): su respuesta es un dato de la receta de cotización. */
export type NumeroDePregunta = { variable: string; unidad: string; min: number | null; max: number | null };

/** Espejo de `PreguntaSolicitud` en la API: sin opciones es de respuesta escrita. */
export type PreguntaSolicitud = {
  texto: string;
  sobre: SobrePregunta;
  opciones: string[];
  textoLibre: boolean;
  obligatoria: boolean;
  /** Sólo en las de número. */
  numero?: NumeroDePregunta;
};

/** Espejo de `SolicitudADemanda`: lo que viene en `Producto.solicitud` y lo que se manda. */
export type SolicitudADemanda = { preguntas: PreguntaSolicitud[] };

/** "Color", "color " y "Colór" son la misma opción (igual que `claveDeCampo` de la API). */
export function claveDeTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function enUnaLinea(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Por qué una pregunta no se puede guardar, o null. Sin número: se muestra adentro de la pregunta. */
export function problemaDePregunta(pregunta: PreguntaSolicitud): string | null {
  const texto = enUnaLinea(pregunta.texto);
  if (texto.length < LARGO_MIN_PREGUNTA) return "Escribí la pregunta.";
  if (texto.length > LARGO_MAX_PREGUNTA) return "La pregunta es demasiado larga.";
  if (pregunta.opciones.length > MAX_OPCIONES) return `Puede tener hasta ${MAX_OPCIONES} opciones.`;
  if (pregunta.numero) {
    const { variable, unidad, min, max } = pregunta.numero;
    if (pregunta.opciones.length > 0) return "Una pregunta de número no lleva opciones.";
    if (!PATRON_VARIABLE.test(variable)) return "El nombre del dato tiene que ser una palabra sin espacios ni tildes (por ejemplo, ancho).";
    if (unidad.length > LARGO_MAX_UNIDAD_PREGUNTA) return "La unidad es demasiado larga.";
    for (const limite of [min, max]) {
      if (limite !== null && (!Number.isFinite(limite) || limite < 0 || limite > NUMERO_MAX_RESPUESTA)) return "El rango no es válido.";
    }
    if (min !== null && max !== null && min > max) return "El mínimo es mayor que el máximo.";
    return null;
  }
  const vistas = new Set<string>();
  for (const opcion of pregunta.opciones) {
    const clave = claveDeTexto(opcion);
    if (!clave) return "Hay una opción vacía.";
    if (vistas.has(clave)) return `La opción "${enUnaLinea(opcion)}" está repetida.`;
    vistas.add(clave);
  }
  if (!pregunta.textoLibre && pregunta.opciones.length === 0) {
    return "Agregá las opciones para elegir, o dejá que el cliente lo escriba.";
  }
  if (!pregunta.textoLibre && pregunta.opciones.length === 1) {
    return "Con una sola opción no hay nada para elegir: agregá otra o dejá que escriba otra respuesta.";
  }
  return null;
}

/** El primer problema de toda la sección, para la alerta del pie del editor. Ninguna pregunta es válido. */
export function problemaDeSolicitud(preguntas: PreguntaSolicitud[]): string | null {
  if (preguntas.length > MAX_PREGUNTAS) return `Un producto puede tener hasta ${MAX_PREGUNTAS} preguntas.`;
  const vistas = new Set<string>();
  const variables = new Set<string>();
  for (const [indice, pregunta] of preguntas.entries()) {
    const problema = problemaDePregunta(pregunta);
    const texto = enUnaLinea(pregunta.texto);
    if (problema) return texto.length >= LARGO_MIN_PREGUNTA ? `"${texto}": ${problema}` : `Pregunta ${indice + 1}: ${problema}`;
    const clave = claveDeTexto(texto);
    if (vistas.has(clave)) return `La pregunta "${texto}" está repetida.`;
    vistas.add(clave);
    if (pregunta.numero) {
      if (variables.has(pregunta.numero.variable)) return `Hay dos preguntas con el dato "${pregunta.numero.variable}".`;
      variables.add(pregunta.numero.variable);
    }
  }
  return null;
}

/**
 * El nombre del dato que se le propone a una pregunta de número a partir de
 * su texto ("¿Cuánto mide de ancho?" → "ancho"), sin repetir uno ya usado.
 */
export function variableDesdeTexto(texto: string, usadas: ReadonlySet<string>): string {
  const vacias = new Set(["cuanto", "cuantos", "cuanta", "cuantas", "que", "de", "del", "la", "el", "los", "las", "mide", "tiene", "en", "es", "son", "cual", "un", "una"]);
  const palabras = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((palabra) => palabra && !vacias.has(palabra));
  const base = (palabras.slice(0, 2).join("_") || "dato").replace(/^(\d)/, "_$1").slice(0, 24);
  if (!usadas.has(base)) return base;
  for (let n = 2; ; n += 1) if (!usadas.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Los datos de número de un producto: los botones de la receta. */
export function variablesDe(preguntas: readonly PreguntaSolicitud[]): NumeroDePregunta[] {
  return preguntas.flatMap((pregunta) => (pregunta.numero ? [pregunta.numero] : []));
}

/** Los materiales en una línea, sin vacíos ni repetidos (igual que `normalizarMateriales` de la API). */
export function limpiarMateriales(lista: readonly string[]): string[] {
  const vistos = new Set<string>();
  return lista.map(enUnaLinea).filter((material) => {
    const clave = claveDeTexto(material);
    if (!clave || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * El código que se le propone a un producto nuevo a partir del nombre
 * ("Mesa ratona" → "MESA-RATONA"), el primero libre entre los que ya usa la
 * cuenta (MESA-RATONA-2, -3…). El dueño lo puede cambiar.
 */
export function codigoDesdeNombre(nombre: string, usados: ReadonlySet<string>): string {
  const base =
    nombre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "PRODUCTO";
  const ocupado = (codigo: string) => usados.has(codigo.toUpperCase());
  if (!ocupado(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidato = `${base}-${n}`;
    if (!ocupado(candidato)) return candidato;
  }
}
