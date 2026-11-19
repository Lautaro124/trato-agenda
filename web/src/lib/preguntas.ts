import { API_URL, apiFetch } from "./api";
import { cuerpoDeFoto, mensajeDeError } from "./imagenes";
import { ErrorDeApi } from "./productos";

/**
 * Preguntas del pedido (LAU-100). Espejo de `PreguntaPedido` en la API
 * (comercio/preguntas-pedido.rules.ts): mantener sincronizados la forma y los
 * topes. La API valida todo de nuevo al guardar.
 */
export type OpcionPregunta = {
  id: string;
  texto: string;
  imagenId: string | null;
  /** Ids de opciones de la pregunta de la que depende; vacío = en todas. */
  soloSi: string[];
};

export type TipoPregunta = "opciones" | "texto";
export type AlcancePregunta = "global" | "producto";

export type PreguntaPedido = {
  id: string;
  texto: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  alcance: AlcancePregunta;
  productos: string[];
  imagenId: string | null;
  ayuda: string | null;
  dependeDe: { preguntaId: string; siRespuestas: string[] } | null;
  opciones: OpcionPregunta[];
  otra: { etiqueta: string } | null;
};

export type RespuestaGuardada = { pregunta: string; respuesta: string };

/** Espejo de `NotaPedido`: lo que el cliente contestó con sus palabras, con lo que había elegido antes. */
export type NotaPedido = {
  tipo: "texto" | "otra";
  pregunta: string;
  respuesta: string;
  producto: string | null;
  contexto: RespuestaGuardada[];
};

export const MAX_PREGUNTAS = 40;
export const MAX_OPCIONES_POR_RAMA = 12;
export const LARGOS = { texto: 120, opcion: 40, ayuda: 120, etiqueta: 40 } as const;
export const ETIQUETA_OTRA_POR_DEFECTO = "Otro";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

export async function obtenerPreguntas(): Promise<PreguntaPedido[]> {
  const { preguntas } = await apiFetch("/preguntas").then((res) => json<{ preguntas: PreguntaPedido[] }>(res));
  return preguntas;
}

export async function guardarPreguntas(preguntas: PreguntaPedido[]): Promise<PreguntaPedido[]> {
  const res = await apiFetch("/preguntas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preguntas }),
  });
  return (await json<{ preguntas: PreguntaPedido[] }>(res)).preguntas;
}

/** Sube una imagen (se achica antes, como las fotos de productos) y devuelve su id. */
export async function subirImagenPregunta(archivo: File): Promise<string> {
  const res = await apiFetch("/preguntas/imagenes", { method: "POST", body: await cuerpoDeFoto(archivo) });
  if (!res.ok) throw new ErrorDeApi(await mensajeDeError(res));
  return ((await res.json()) as { id: string }).id;
}

/** Una imagen nueva es otro id: no hace falta versión para el caché. */
export function urlImagenPregunta(imagenId: string): string {
  return `${API_URL}/preguntas/imagenes/${encodeURIComponent(imagenId)}`;
}

/** Ids cortos y únicos para preguntas y opciones nuevas (la API sólo pide que sean únicos). */
export function nuevoId(prefijo: "p" | "o"): string {
  return `${prefijo}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function preguntaNueva(): PreguntaPedido {
  return {
    id: nuevoId("p"),
    texto: "",
    tipo: "opciones",
    obligatoria: true,
    alcance: "global",
    productos: [],
    imagenId: null,
    ayuda: null,
    dependeDe: null,
    opciones: [],
    otra: null,
  };
}

/** Las opciones que ve el cliente cuando en la anterior eligió `rama` (null: no depende de otra). */
export function opcionesDeRama(opciones: OpcionPregunta[], rama: string | null): OpcionPregunta[] {
  return opciones.filter((opcion) => opcion.soloSi.length === 0 || (rama !== null && opcion.soloSi.includes(rama)));
}

/**
 * Deja las referencias coherentes después de un cambio: una que depende de
 * otra hereda su alcance y productos, y lo que apuntaba a una pregunta u
 * opción que ya no existe (o que quedó después) se suelta.
 */
export function coherentes(preguntas: PreguntaPedido[]): PreguntaPedido[] {
  const listas: PreguntaPedido[] = [];
  for (const pregunta of preguntas) {
    const padre = pregunta.dependeDe
      ? listas.find((anterior) => anterior.id === pregunta.dependeDe?.preguntaId && anterior.tipo === "opciones")
      : undefined;
    if (!padre) {
      listas.push({
        ...pregunta,
        dependeDe: null,
        opciones: pregunta.opciones.map((opcion) => ({ ...opcion, soloSi: [] })),
      });
      continue;
    }
    const ids = new Set(padre.opciones.map((opcion) => opcion.id));
    listas.push({
      ...pregunta,
      alcance: padre.alcance,
      productos: [...padre.productos],
      dependeDe: {
        preguntaId: padre.id,
        siRespuestas: (pregunta.dependeDe?.siRespuestas ?? []).filter((id) => ids.has(id)),
      },
      // Una opción que sólo valía para opciones borradas se va con ellas.
      opciones: pregunta.opciones.flatMap((opcion) => {
        if (opcion.soloSi.length === 0) return [opcion];
        const soloSi = opcion.soloSi.filter((id) => ids.has(id));
        return soloSi.length > 0 ? [{ ...opcion, soloSi }] : [];
      }),
    });
  }
  return listas;
}

/** Valida en el navegador lo obvio, para no gastar un viaje; el resto lo dice la API. */
export function problemaDe(preguntas: PreguntaPedido[]): string | null {
  if (preguntas.length > MAX_PREGUNTAS) return `Podés tener hasta ${MAX_PREGUNTAS} preguntas.`;
  for (const [indice, pregunta] of preguntas.entries()) {
    const lugar = `La pregunta ${indice + 1}`;
    if (!pregunta.texto.trim()) return `${lugar} está vacía: escribí qué le pregunta el asistente o borrala.`;
    if (pregunta.alcance === "producto" && pregunta.productos.length === 0) {
      return `${lugar} es para ciertos productos: elegí al menos uno.`;
    }
    if (pregunta.tipo === "opciones" && pregunta.opciones.every((opcion) => !opcion.texto.trim())) {
      return `${lugar} necesita al menos una opción.`;
    }
  }
  return null;
}
