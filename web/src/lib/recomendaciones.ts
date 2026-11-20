import { apiFetch } from "./api";
import { ErrorDeApi } from "./productos";
import type { PreguntaPedido } from "./preguntas";

/**
 * Recomendaciones y flujos conversacionales (LAU-105). Espejo de
 * `ConfiguracionRecomendaciones` en la API (comercio/recomendaciones.rules.ts):
 * mantener sincronizados la forma y los topes. La API valida todo de nuevo al
 * guardar.
 */
export type Disparador =
  | { tipo: "consulta"; necesidad: string; ejemplos: string[] }
  | { tipo: "paso"; preguntaId: string; opciones: string[] }
  /** Mientras le hace la pregunta, el cliente cuenta una necesidad en vez de elegir una opción. */
  | { tipo: "pregunta"; preguntaId: string; necesidad: string; ejemplos: string[] };

export type AccionRecomendar = {
  tipo: "recomendar";
  productos: string[];
  opciones: { preguntaId: string; opcionIds: string[] } | null;
  criterio: string | null;
};

export type Accion =
  | { tipo: "responder"; texto: string }
  | { tipo: "preguntar"; pregunta: string }
  | AccionRecomendar
  | { tipo: "continuar"; preguntaId: string };

export type SiNoCumple = "explicar" | "derivar";
export type Requisito = { dato: string; pregunta: string; siNoCumple: SiNoCumple };

export type Excepcion = { productoId: string; excluirProductos: string[]; excluirOpciones: string[]; nota: string | null };

export type Recomendacion = {
  id: string;
  nombre: string;
  activa: boolean;
  disparador: Disparador;
  alcance: "global" | "producto";
  productos: string[];
  accion: Accion;
  requisito: Requisito | null;
  retomarPedido: boolean;
  excepciones: Excepcion[];
};

export type Elemento = { tipo: "producto"; productoId: string } | { tipo: "opcion"; preguntaId: string; opcionId: string };
export type Propiedad = { nombre: string; valor: string };
export type PropiedadesDeElemento = { elemento: Elemento; propiedades: Propiedad[] };
export type SinCoincidencia = "catalogo" | "derivar";

export type ConfiguracionRecomendaciones = {
  recomendaciones: Recomendacion[];
  propiedades: PropiedadesDeElemento[];
  sinCoincidencia: SinCoincidencia;
};

/** Espejo de `ResultadoRecomendacion`: lo que resolvió consultar_recomendacion en una prueba. */
export type ResultadoRecomendacion = {
  estado: "aplicada" | "falta_dato" | "no_cumple" | "ninguna";
  regla: { id: string; nombre: string; accion: Accion["tipo"]; activa: boolean } | null;
  requisito: { dato: string; estado: "cumple" | "no_cumple" | "no_se" } | null;
  candidatos: Array<{
    tipo: "producto" | "opcion";
    id: string;
    nombre: string;
    pregunta: string | null;
    disponible: boolean;
    propiedades: Propiedad[];
  }>;
  propiedadesDelProducto: Propiedad[];
  evaluadas: Array<{ id: string; nombre: string; aplica: boolean; motivo: string }>;
  nota: string | null;
};

export const MAX_RECOMENDACIONES = 40;
export const MAX_EJEMPLOS = 8;
export const MAX_PROPIEDADES_POR_ELEMENTO = 12;
export const LARGOS = {
  nombre: 60,
  necesidad: 240,
  ejemplo: 120,
  texto: 500,
  pregunta: 160,
  dato: 100,
  criterio: 240,
  nota: 240,
  propiedadNombre: 40,
  propiedadValor: 120,
} as const;

export const ETIQUETA_ACCION: Record<Accion["tipo"], string> = {
  responder: "Responder",
  preguntar: "Hacer una pregunta",
  recomendar: "Recomendar del catálogo",
  continuar: "Continuar con otro paso",
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function obtenerRecomendaciones(): Promise<ConfiguracionRecomendaciones> {
  return apiFetch("/recomendaciones").then((res) => json<ConfiguracionRecomendaciones>(res));
}

export async function guardarRecomendaciones(configuracion: ConfiguracionRecomendaciones): Promise<ConfiguracionRecomendaciones> {
  const res = await apiFetch("/recomendaciones", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(configuracion) });
  return json<ConfiguracionRecomendaciones>(res);
}

export function probarRecomendacion(mensaje: string) {
  return apiFetch("/recomendaciones/probar", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ mensaje }) }).then(
    (res) => json<{ reply: string; recomendaciones: ResultadoRecomendacion[] }>(res),
  );
}

export function nuevoIdRecomendacion(): string {
  return `r${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function recomendacionNueva(): Recomendacion {
  return {
    id: nuevoIdRecomendacion(),
    nombre: "",
    activa: false,
    disparador: { tipo: "consulta", necesidad: "", ejemplos: [] },
    alcance: "producto",
    productos: [],
    accion: { tipo: "recomendar", productos: [], opciones: null, criterio: null },
    requisito: null,
    retomarPedido: true,
    excepciones: [],
  };
}

export function claveDeElemento(elemento: Elemento): string {
  return elemento.tipo === "producto" ? `p:${elemento.productoId}` : `o:${elemento.preguntaId}:${elemento.opcionId}`;
}

/** Las propiedades de un producto u opción (vacío si no tiene). */
export function propiedadesDe(configuracion: ConfiguracionRecomendaciones, elemento: Elemento): Propiedad[] {
  const clave = claveDeElemento(elemento);
  return configuracion.propiedades.find((entrada) => claveDeElemento(entrada.elemento) === clave)?.propiedades ?? [];
}

/** Reemplaza las propiedades de un elemento; una lista vacía lo saca. */
export function conPropiedades(
  configuracion: ConfiguracionRecomendaciones,
  elemento: Elemento,
  propiedades: Propiedad[],
): ConfiguracionRecomendaciones {
  const clave = claveDeElemento(elemento);
  const resto = configuracion.propiedades.filter((entrada) => claveDeElemento(entrada.elemento) !== clave);
  return { ...configuracion, propiedades: propiedades.length > 0 ? [...resto, { elemento, propiedades }] : resto };
}

/** Las preguntas de opciones: las únicas que pueden disparar una regla o ofrecer opciones para recomendar. */
export function preguntasConOpciones(preguntas: PreguntaPedido[]): PreguntaPedido[] {
  return preguntas.filter((pregunta) => pregunta.tipo === "opciones" && pregunta.opciones.length > 0);
}

/** Lo mismo que valida la API (normalizarConfiguracion), sin el catálogo: el primer problema o null. */
export function problemaDe(configuracion: ConfiguracionRecomendaciones, preguntas: PreguntaPedido[]): string | null {
  const nombres = new Set<string>();
  for (const regla of configuracion.recomendaciones) {
    const nombre = regla.nombre.trim();
    if (!nombre) return "Ponele un nombre a cada recomendación.";
    const clave = nombre.toLocaleLowerCase("es");
    if (nombres.has(clave)) return `Ya hay una recomendación llamada «${nombre}».`;
    nombres.add(clave);
    const de = `«${nombre}»`;
    if (regla.disparador.tipo === "consulta" && !regla.disparador.necesidad.trim()) {
      return `Contá qué necesita el cliente en ${de}.`;
    }
    if (regla.disparador.tipo === "paso") {
      const { preguntaId } = regla.disparador;
      if (!preguntas.some((p) => p.id === preguntaId)) return `Elegí después de qué pregunta se activa ${de}.`;
    }
    if (regla.disparador.tipo === "pregunta") {
      const { preguntaId, necesidad } = regla.disparador;
      if (!preguntas.some((p) => p.id === preguntaId)) return `Elegí en qué pregunta se activa ${de}.`;
      if (!necesidad.trim()) return `Contá qué cuenta el cliente en ${de}.`;
    }
    if (regla.alcance === "producto" && regla.productos.length === 0) {
      return `Elegí a qué productos aplica ${de}, o que aplique a todo el catálogo.`;
    }
    const accion = regla.accion;
    if (accion.tipo === "responder" && !accion.texto.trim()) return `Escribí qué responde el asistente en ${de}.`;
    if (accion.tipo === "preguntar" && !accion.pregunta.trim()) return `Escribí qué pregunta el asistente en ${de}.`;
    if (accion.tipo === "continuar" && !preguntas.some((p) => p.id === accion.preguntaId)) {
      return `Elegí con qué paso sigue ${de}.`;
    }
    if (accion.tipo === "recomendar" && accion.productos.length === 0 && !accion.opciones) {
      return `Elegí qué productos u opciones puede recomendar ${de}.`;
    }
    if (regla.requisito && (!regla.requisito.dato.trim() || !regla.requisito.pregunta.trim())) {
      return `Completá el dato que necesita ${de} y cómo se lo pregunta.`;
    }
  }
  for (const { propiedades } of configuracion.propiedades) {
    if (propiedades.some((p) => !p.nombre.trim() !== !p.valor.trim())) return "Cada propiedad necesita nombre y valor.";
  }
  return null;
}
