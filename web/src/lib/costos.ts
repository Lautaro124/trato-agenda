/**
 * Materiales y costos de los productos a medida (LAU-26) del lado de la
 * pantalla. Los tipos espejan api/src/comercio/costos.rules.ts; la cuenta de
 * la cotización no se copia: la vista previa la pide a `/costos/simular`.
 */
import { apiFetch } from "./api";
import { ErrorDeApi } from "./productos";
import type { RenglonPresupuesto } from "./ventas";

export const TIPOS_INSUMO = ["material", "proceso", "mano_obra"] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export const UNIDADES_INSUMO = ["unidad", "m", "m2", "m3", "cm", "cm2", "litro", "kg", "g", "hora", "minuto"] as const;
export type UnidadInsumo = (typeof UNIDADES_INSUMO)[number];

export const ETIQUETA_UNIDAD: Record<UnidadInsumo, string> = {
  unidad: "unidad",
  m: "metro",
  m2: "m²",
  m3: "m³",
  cm: "cm",
  cm2: "cm²",
  litro: "litro",
  kg: "kg",
  g: "gramo",
  hora: "hora",
  minuto: "minuto",
};

/** Las tres secciones de /costos, con lo que dice cada una. */
export const SECCIONES_INSUMO: Record<TipoInsumo, { titulo: string; ayuda: string; ejemplo: string; unidad: UnidadInsumo }> = {
  material: {
    titulo: "Materiales",
    ayuda: "Lo que comprás para hacer cada pedido: placas, telas, pintura, hilo.",
    ejemplo: "Melamina blanca 18 mm",
    unidad: "m2",
  },
  proceso: {
    titulo: "Fabricación y máquinas",
    ayuda: "Lo que cuesta cada tipo de fabricación o usar una máquina: corte láser, CNC, impresión 3D, horno.",
    ejemplo: "Corte láser",
    unidad: "hora",
  },
  mano_obra: {
    titulo: "Mano de obra",
    ayuda: "Lo que vale el trabajo de cada persona por hora o por pieza.",
    ejemplo: "Carpintero",
    unidad: "hora",
  },
};

export const MAX_INSUMOS = 200;
export const LARGO_MAX_NOMBRE_INSUMO = 60;
export const MAX_RENGLONES_RECETA = 20;
export const MAX_EXTRAS = 10;
export const LARGO_MAX_FORMULA = 200;

export type Insumo = {
  id: string;
  tipo: TipoInsumo;
  nombre: string;
  unidad: UnidadInsumo;
  costoCentavos: number;
  activo: boolean;
};

export type Condicion = { pregunta: string; opcion: string };

export type Extra = {
  nombre: string;
  modo: "fijo" | "porcentaje" | "formula";
  /** fijo: centavos; porcentaje: %. */
  valor: number;
  formula?: string;
  cuando?: Condicion;
};

export type RenglonReceta = { insumoId: string; cantidad: string; cuando?: Condicion };
export type Receta = { renglones: RenglonReceta[]; extras: Extra[] };

export const POLITICAS_COTIZACION = ["manual", "revision", "automatica"] as const;
export type PoliticaCotizacion = (typeof POLITICAS_COTIZACION)[number];

export type ConfigCotizacion = {
  extras: Array<Extra & { modo: "fijo" | "porcentaje" }>;
  redondeoCentavos: number;
  estimativo: boolean;
  vigenciaDias: number | null;
  desgloseAlCliente: "total" | "detallado";
};

export type CostosDelComercio = { insumos: Insumo[]; config: ConfigCotizacion };

export type ResultadoSimulacion =
  | { ok: true; renglones: RenglonPresupuesto[]; totalCentavos: number; valores: Record<string, number> }
  | { ok: false; motivo: string; faltan: string[] };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function obtenerCostos(): Promise<CostosDelComercio> {
  return apiFetch("/costos").then((res) => json<CostosDelComercio>(res));
}

export type InsumoAGuardar = Pick<Insumo, "tipo" | "nombre" | "unidad" | "costoCentavos">;

export function crearInsumo(insumo: InsumoAGuardar): Promise<Insumo> {
  return apiFetch("/costos/insumos", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(insumo) }).then((res) =>
    json<Insumo>(res),
  );
}

export function actualizarInsumo(id: string, insumo: InsumoAGuardar): Promise<Insumo> {
  return apiFetch(`/costos/insumos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(insumo),
  }).then((res) => json<Insumo>(res));
}

export function borrarInsumo(id: string): Promise<void> {
  return apiFetch(`/costos/insumos/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) => json<void>(res));
}

export function guardarConfigCotizacion(config: ConfigCotizacion): Promise<ConfigCotizacion> {
  return apiFetch("/costos/config", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(config) }).then((res) =>
    json<ConfigCotizacion>(res),
  );
}

export function simularCotizacion(datos: {
  receta: Receta;
  solicitud: unknown;
  respuestas: Array<{ pregunta: string; respuesta: string }>;
}): Promise<ResultadoSimulacion> {
  return apiFetch("/costos/simular", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(datos) }).then((res) =>
    json<ResultadoSimulacion>(res),
  );
}
