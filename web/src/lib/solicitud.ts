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

/** Espejo de `PreguntaSolicitud` en la API: sin opciones es de respuesta escrita. */
export type PreguntaSolicitud = {
  texto: string;
  sobre: SobrePregunta;
  opciones: string[];
  textoLibre: boolean;
  obligatoria: boolean;
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

/** El primer problema de toda la sección, para la alerta del pie del editor. */
export function problemaDeSolicitud(preguntas: PreguntaSolicitud[]): string | null {
  if (preguntas.length === 0) return "Agregá al menos una pregunta para el pedido a medida.";
  if (preguntas.length > MAX_PREGUNTAS) return `Un producto puede tener hasta ${MAX_PREGUNTAS} preguntas.`;
  const vistas = new Set<string>();
  for (const [indice, pregunta] of preguntas.entries()) {
    const problema = problemaDePregunta(pregunta);
    const texto = enUnaLinea(pregunta.texto);
    if (problema) return texto.length >= LARGO_MIN_PREGUNTA ? `"${texto}": ${problema}` : `Pregunta ${indice + 1}: ${problema}`;
    const clave = claveDeTexto(texto);
    if (vistas.has(clave)) return `La pregunta "${texto}" está repetida.`;
    vistas.add(clave);
  }
  return null;
}

/** Cómo se contesta, para la pregunta plegada (las opciones ya se ven como pastillas). */
export function resumenDeRespuesta(pregunta: PreguntaSolicitud): string | null {
  if (pregunta.opciones.length === 0) return "Responde con sus palabras";
  return pregunta.textoLibre ? "o escribe otra respuesta" : null;
}
