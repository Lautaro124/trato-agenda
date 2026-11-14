import { apiFetch } from "@/lib/api";
import { ErrorDeApi } from "@/lib/productos";

/*
 * Módulo de envíos (LAU-102). Tipos de la API y las validaciones de una zona
 * copiadas de api/src/envios/envios.rules.ts: si cambian allá, cambiarlas acá.
 * La API valida siempre; esto es para avisar antes de guardar.
 */

export type EstadoZona = "tarifa" | "cotizacion" | "sin_cobertura";
export type Modalidad = "domicilio" | "sucursal";
export type Nivel = "cp" | "localidad" | "provincia" | "pais";
export type AccionSinTarifa = "cotizar_aparte" | "derivar";

export const DIAS_DESPACHO = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export const NOMBRE_DIA: Record<string, string> = {
  lun: "Lun",
  mar: "Mar",
  mie: "Mié",
  jue: "Jue",
  vie: "Vie",
  sab: "Sáb",
  dom: "Dom",
};
export const LARGO_MAX_NOMBRE_ZONA = 60;
export const LARGO_MAX_INSTRUCCIONES = 300;
export const MAX_DIAS_PLAZO = 365;

export const ETIQUETA_ESTADO: Record<EstadoZona, string> = {
  tarifa: "Tarifa definida",
  cotizacion: "Requiere cotización",
  sin_cobertura: "Sin cobertura",
};

export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  cp: "CP",
  localidad: "Localidad",
  provincia: "Provincia",
  pais: "País",
};

export type Cobertura = {
  nivel: Nivel;
  provinciaId: string | null;
  localidadId: string | null;
  cp: string | null;
  etiqueta: string;
};

export type Zona = {
  id: string;
  nombre: string;
  activa: boolean;
  estado: EstadoZona;
  domicilio: boolean;
  sucursal: boolean;
  tarifaDomicilioCentavos: number | null;
  tarifaSucursalCentavos: number | null;
  gratisDesdeCentavos: number | null;
  preparacionDias: number | null;
  transporteDesdeDias: number | null;
  transporteHastaDias: number | null;
  diasDespacho: string[];
  instrucciones: string | null;
  coberturas: Cobertura[];
};

export type ZonaAGuardar = Omit<Zona, "id" | "coberturas"> & {
  coberturas: Array<Omit<Cobertura, "etiqueta">>;
};

export type Conflicto = {
  clave: string;
  lugar: string;
  modalidad: Modalidad;
  zonas: Array<{ id: string; nombre: string }>;
};

export type ConfiguracionEnvios = {
  activo: boolean;
  pais: string;
  moneda: "ARS" | "USD";
  sinTarifa: AccionSinTarifa;
  haceEnvios: boolean;
  retiroEnLocal: boolean;
  fechaCatalogo: string;
};

export type Ubicacion = {
  nivel: "provincia" | "localidad" | "cp";
  provinciaId: string;
  localidadId: string | null;
  cp: string | null;
  etiqueta: string;
};

export type ConsultaSinResolver = {
  motivo: "sin_configurar" | "conflicto" | "ambigua" | "contradiccion" | "error";
  lugar: string;
  cantidad: number;
  ultima: string;
};

export const ETIQUETA_MOTIVO: Record<ConsultaSinResolver["motivo"], string> = {
  sin_configurar: "Sin configurar",
  conflicto: "Conflicto",
  ambigua: "Ubicación ambigua",
  contradiccion: "Datos que no coinciden",
  error: "Error técnico",
};

export type ResolucionModalidad = {
  modalidad: Modalidad;
  estado: EstadoZona | "sin_configurar" | "conflicto";
  zona: { id: string; nombre: string } | null;
  zonasEnConflicto: Array<{ id: string; nombre: string }>;
  tarifaCentavos: number | null;
  tarifaListaCentavos: number | null;
  moneda: string;
  gratis: { desdeCentavos: number; aplica: "si" | "no" | "condicion" } | null;
  plazo: { desdeDias: number; hastaDias: number } | null;
};

export type ResolucionEnvio = {
  estado: "resuelto" | "falta_dato" | "ubicacion_incierta" | "contradiccion" | "conflicto" | "sin_configurar" | "inactivo" | "error";
  destino: { provincia: string | null; localidad: string | null; cp: string | null };
  faltante: "provincia" | "localidad" | "codigo_postal" | null;
  candidatos: string[];
  detalle: string | null;
  modalidades: ResolucionModalidad[];
  retiroEnLocal: boolean;
};

export const ETIQUETA_RESOLUCION: Record<ResolucionEnvio["estado"], string> = {
  resuelto: "Resuelto",
  falta_dato: "Falta un dato",
  ubicacion_incierta: "Ubicación incierta",
  contradiccion: "Datos que no coinciden",
  conflicto: "Conflicto de configuración",
  sin_configurar: "Sin configurar",
  inactivo: "Módulo apagado",
  error: "Error técnico",
};

export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  domicilio: "Envío a domicilio",
  sucursal: "Retiro en sucursal del correo",
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function obtenerConfiguracion() {
  return apiFetch("/envios/configuracion").then((res) => json<ConfiguracionEnvios>(res));
}

export function guardarConfiguracion(cambios: Partial<Pick<ConfiguracionEnvios, "activo" | "moneda" | "sinTarifa">>) {
  return apiFetch("/envios/configuracion", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(cambios) }).then(
    (res) => json<ConfiguracionEnvios>(res),
  );
}

export function listarZonas() {
  return apiFetch("/envios/zonas").then((res) => json<Zona[]>(res));
}

export function listarConflictos() {
  return apiFetch("/envios/conflictos").then((res) => json<Conflicto[]>(res));
}

export function listarSinResolver() {
  return apiFetch("/envios/sin-resolver").then((res) => json<ConsultaSinResolver[]>(res));
}

export function guardarZona(zona: ZonaAGuardar, id?: string) {
  return apiFetch(id ? `/envios/zonas/${encodeURIComponent(id)}` : "/envios/zonas", {
    method: id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(zona),
  }).then((res) => json<{ zona: Zona; conflictos: Conflicto[] }>(res));
}

export function cambiarActiva(id: string, activa: boolean) {
  return apiFetch(`/envios/zonas/${encodeURIComponent(id)}/activa`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ activa }),
  }).then((res) => json<{ zona: Zona; conflictos: Conflicto[] }>(res));
}

export function eliminarZona(id: string) {
  return apiFetch(`/envios/zonas/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) => json<void>(res));
}

export function buscarUbicaciones(q: string) {
  return apiFetch(`/envios/ubicaciones?q=${encodeURIComponent(q)}`).then((res) => json<Ubicacion[]>(res));
}

export function probarEnvio(mensaje: string) {
  return apiFetch("/envios/probar", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ mensaje }) }).then(
    (res) => json<{ reply: string; resoluciones: ResolucionEnvio[] }>(res),
  );
}

/** Lo mismo que valida la API (validarZona), sin el catálogo: el problema para mostrar o null. */
export function problemaDeZona(zona: ZonaAGuardar): string | null {
  const nombre = zona.nombre.trim();
  if (!nombre) return "Ponele un nombre a la zona.";
  if (nombre.length > LARGO_MAX_NOMBRE_ZONA) return `El nombre puede tener hasta ${LARGO_MAX_NOMBRE_ZONA} caracteres.`;
  if (zona.coberturas.length === 0) return "Sumá al menos un lugar a la cobertura.";
  for (const dias of [zona.preparacionDias, zona.transporteDesdeDias, zona.transporteHastaDias]) {
    if (dias !== null && (!Number.isInteger(dias) || dias < 0 || dias > MAX_DIAS_PLAZO)) {
      return `Los plazos van en días hábiles, de 0 a ${MAX_DIAS_PLAZO}.`;
    }
  }
  if ((zona.transporteDesdeDias === null) !== (zona.transporteHastaDias === null)) {
    return 'Completá el transporte "desde" y "hasta", o dejá los dos vacíos.';
  }
  if (zona.transporteDesdeDias !== null && zona.transporteHastaDias !== null && zona.transporteDesdeDias > zona.transporteHastaDias) {
    return 'El transporte "desde" no puede ser mayor que el "hasta".';
  }
  if (zona.instrucciones && zona.instrucciones.length > LARGO_MAX_INSTRUCCIONES) {
    return `Las aclaraciones pueden tener hasta ${LARGO_MAX_INSTRUCCIONES} caracteres.`;
  }
  if (zona.estado === "sin_cobertura") return null;
  if (!zona.domicilio && !zona.sucursal) return "Elegí al menos una forma de entrega: domicilio o sucursal.";
  if (zona.estado === "tarifa") {
    if (zona.domicilio && zona.tarifaDomicilioCentavos === null) {
      return 'Falta la tarifa de envío a domicilio. Si no cobrás, marcá "Sin cargo".';
    }
    if (zona.sucursal && zona.tarifaSucursalCentavos === null) {
      return 'Falta la tarifa de retiro en sucursal. Si no cobrás, marcá "Sin cargo".';
    }
  }
  return null;
}

/** Deja la zona en la forma que acepta la API según su estado (sin tarifas donde no van). */
export function normalizarParaGuardar(zona: ZonaAGuardar): ZonaAGuardar {
  if (zona.estado === "sin_cobertura") {
    return {
      ...zona,
      domicilio: false,
      sucursal: false,
      tarifaDomicilioCentavos: null,
      tarifaSucursalCentavos: null,
      gratisDesdeCentavos: null,
      preparacionDias: null,
      transporteDesdeDias: null,
      transporteHastaDias: null,
      diasDespacho: [],
    };
  }
  const cotizacion = zona.estado === "cotizacion";
  return {
    ...zona,
    tarifaDomicilioCentavos: zona.domicilio && !cotizacion ? zona.tarifaDomicilioCentavos : null,
    tarifaSucursalCentavos: zona.sucursal && !cotizacion ? zona.tarifaSucursalCentavos : null,
    gratisDesdeCentavos: cotizacion ? null : zona.gratisDesdeCentavos,
    instrucciones: zona.instrucciones?.trim() ? zona.instrucciones.trim() : null,
  };
}

export function zonaVacia(): ZonaAGuardar {
  return {
    nombre: "",
    activa: true,
    estado: "tarifa",
    domicilio: true,
    sucursal: false,
    tarifaDomicilioCentavos: null,
    tarifaSucursalCentavos: null,
    gratisDesdeCentavos: null,
    preparacionDias: null,
    transporteDesdeDias: null,
    transporteHastaDias: null,
    diasDespacho: [],
    instrucciones: null,
    coberturas: [],
  };
}

/** "2 a 4 días hábiles" con preparación + transporte, o null. */
export function plazoDeZona(zona: Pick<Zona, "preparacionDias" | "transporteDesdeDias" | "transporteHastaDias">): string | null {
  const prep = zona.preparacionDias ?? 0;
  if (zona.transporteDesdeDias !== null && zona.transporteHastaDias !== null) {
    const desde = prep + zona.transporteDesdeDias;
    const hasta = prep + zona.transporteHastaDias;
    return desde === hasta ? `${desde} días hábiles` : `${desde} a ${hasta} días hábiles`;
  }
  return zona.preparacionDias !== null ? `${prep} días hábiles` : null;
}
