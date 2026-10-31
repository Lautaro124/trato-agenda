import { apiFetch } from "./api";
import { PORCENTAJE_MAX } from "./descuentos";
import { ErrorDeApi } from "./productos";

/**
 * Cuotas, descuento en efectivo y cobro sin link del comercio (LAU-34). Topes
 * y validación copiados de api/src/comercio/condiciones-pago.rules.ts:
 * mantenerlos iguales.
 */
export const MAX_PLANES_CUOTAS = 6;
export const MIN_CUOTAS = 2;
export const MAX_CUOTAS = 24;
export const RECARGO_MAX_PORCENTAJE = 100;

export const LARGO_MAX_TITULAR = 80;
export const LARGO_MAX_MENSAJE_COBRO = 400;
export const VARIABLES_MENSAJE_COBRO = ["nombre", "total", "detalle"] as const;
const ALIAS = /^[a-z0-9.-]{6,20}$/;
const CBU = /^\d{22}$/;

export type PlanCuotas = { cuotas: number; recargoPorcentaje: number };

/** Cómo se cobra un pedido sin link; null = se coordina por el chat. */
export type CobroManual =
  | { modo: "transferencia"; alias: string; titular: string }
  | { modo: "otro_canal"; mensaje: string };

/** Espejo de `CondicionesPago` en la API. */
export type CondicionesPago = {
  planesCuotas: PlanCuotas[];
  descuentoEfectivoPorcentaje: number | null;
  cobroManual: CobroManual | null;
};

/** El alias como lo guarda la API: sin espacios y en minúsculas. */
export function normalizarAlias(alias: string): string {
  return alias.replace(/\s+/g, "").toLowerCase();
}

function problemaDeCobroManual(cobro: CobroManual | null): string | null {
  if (!cobro) return null;
  if (cobro.modo === "transferencia") {
    const alias = normalizarAlias(cobro.alias);
    if (!ALIAS.test(alias) && !CBU.test(alias)) {
      return "El alias tiene que tener de 6 a 20 letras, números, puntos o guiones (o ser un CBU/CVU de 22 dígitos).";
    }
    const titular = cobro.titular.replace(/\s+/g, " ").trim();
    if (!titular) return "Escribí a nombre de quién está la cuenta.";
    if (titular.length > LARGO_MAX_TITULAR) return `El titular puede tener como mucho ${LARGO_MAX_TITULAR} caracteres.`;
    return null;
  }
  const mensaje = cobro.mensaje.trim();
  if (!mensaje) return "Escribí el mensaje que le llega al cliente.";
  if (mensaje.length > LARGO_MAX_MENSAJE_COBRO) return `El mensaje puede tener como mucho ${LARGO_MAX_MENSAJE_COBRO} caracteres.`;
  const desconocida = [...mensaje.matchAll(/\{(\w+)\}/g)]
    .map((coincidencia) => coincidencia[1])
    .find((variable) => !(VARIABLES_MENSAJE_COBRO as readonly string[]).includes(variable));
  if (desconocida) return `{${desconocida}} no es un dato que se pueda completar en el mensaje.`;
  return null;
}

function esEntero(valor: number, min: number, max: number): boolean {
  return Number.isInteger(valor) && valor >= min && valor <= max;
}

/** El mismo motivo que daría la API, o null si se puede guardar. */
export function problemaDeCondiciones(condiciones: CondicionesPago): string | null {
  if (condiciones.planesCuotas.length > MAX_PLANES_CUOTAS) return `Podés tener hasta ${MAX_PLANES_CUOTAS} planes de cuotas.`;
  const vistas = new Set<number>();
  for (const plan of condiciones.planesCuotas) {
    if (!esEntero(plan.cuotas, MIN_CUOTAS, MAX_CUOTAS)) return `Las cuotas tienen que ser de ${MIN_CUOTAS} a ${MAX_CUOTAS}.`;
    if (!esEntero(plan.recargoPorcentaje, 0, RECARGO_MAX_PORCENTAJE)) {
      return `El recargo tiene que ser de 0% a ${RECARGO_MAX_PORCENTAJE}%.`;
    }
    if (vistas.has(plan.cuotas)) return `Hay dos planes de ${plan.cuotas} cuotas: dejá uno.`;
    vistas.add(plan.cuotas);
  }
  const efectivo = condiciones.descuentoEfectivoPorcentaje;
  if (efectivo !== null && !esEntero(efectivo, 1, PORCENTAJE_MAX)) {
    return `El descuento en efectivo tiene que ser de 1% a ${PORCENTAJE_MAX}%.`;
  }
  return problemaDeCobroManual(condiciones.cobroManual);
}

/** "3 cuotas sin interés", "6 cuotas con 15% de recargo". */
export function nombreDePlan(plan: PlanCuotas): string {
  return `${plan.cuotas} cuotas ${plan.recargoPorcentaje === 0 ? "sin interés" : `con ${plan.recargoPorcentaje}% de recargo`}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

export function obtenerCondicionesPago(): Promise<CondicionesPago> {
  return apiFetch("/condiciones-pago").then((res) => json<CondicionesPago>(res));
}

export function guardarCondicionesPago(condiciones: CondicionesPago): Promise<CondicionesPago> {
  return apiFetch("/condiciones-pago", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(condiciones),
  }).then((res) => json<CondicionesPago>(res));
}
