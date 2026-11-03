import { API_URL } from "./api";
import type { PrecioPlan } from "./suscripcion";

/** Si la API no contesta en este tiempo, el build no se queda colgado. */
const ESPERA_MS = 5000;

/**
 * Precio del plan para el HTML estático de la landing. Se llama desde un server
 * component, así que `next build` lo pide una vez y queda en el HTML: cambiar
 * SUSCRIPCION_PRECIO_PRO_ARS exige rebuildear la web.
 *
 * Devuelve null si la API no está accesible durante el build (compose y E2E
 * buildean la web antes de que la API arranque). En ese caso la tarjeta lo pide
 * desde el browser, como antes: nunca se muestra un número inventado.
 */
export async function precioDelBuild(): Promise<PrecioPlan | null> {
  try {
    const res = await fetch(`${API_URL}/suscripcion/precio`, {
      cache: "force-cache",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const datos = (await res.json()) as PrecioPlan;
    if (!esPrecioValido(datos)) throw new Error("respuesta con otra forma");
    return datos;
  } catch (error) {
    console.warn(
      `No se pudo obtener el precio para la landing estática; se va a pedir desde el browser (${String(error)}).`,
    );
    return null;
  }
}

function esPrecioValido(datos: PrecioPlan): boolean {
  return (
    typeof datos?.moneda === "string" &&
    Array.isArray(datos.planes) &&
    datos.planes.length > 0 &&
    datos.planes.every(
      (p) => typeof p.nombre === "string" && Number.isFinite(p.monto) && Number.isFinite(p.chats),
    )
  );
}
