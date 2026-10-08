import { apiFetch } from "./api";
import { ErrorDeApi, formatearCentavos } from "./productos";

export type TipoDescuento = "porcentaje" | "monto";
export type AlcanceDescuento = "producto" | "categoria" | "catalogo";

/** Tope del porcentaje, el mismo que PORCENTAJE_MAX de la API. */
export const PORCENTAJE_MAX = 90;

/** Espejo de `DescuentoPublico` en la API. Las fechas son días "AAAA-MM-DD", inclusive. */
export type Descuento = {
  id: string;
  alcance: AlcanceDescuento;
  nombre: string;
  categoria: string | null;
  tipo: TipoDescuento;
  /** Porcentaje, o centavos si es un monto fijo. */
  valor: number;
  activo: boolean;
  desde: string | null;
  hasta: string | null;
  etiqueta: string;
};

/** Espejo de `DescuentoDeVariante`: el que hoy le toca a una variante. */
export type DescuentoDeVariante = {
  alcance: AlcanceDescuento;
  etiqueta: string;
  nombre: string;
  hastaDia: string | null;
  descuentoCentavos: number;
};

/** Body del descuento de un producto (dentro de `ProductoAGuardar`) y base de una promo. */
export type DescuentoAGuardar = {
  tipo: TipoDescuento;
  valor: number;
  activo: boolean;
  desde: string | null;
  hasta: string | null;
};

export type PromocionAGuardar = DescuentoAGuardar & { nombre: string; categoria: string | null };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function listarPromociones() {
  return apiFetch("/descuentos").then((res) => json<Descuento[]>(res));
}

export function guardarPromocion(promocion: PromocionAGuardar, id?: string) {
  return apiFetch(id ? `/descuentos/${id}` : "/descuentos", {
    method: id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(promocion),
  }).then((res) => json<Descuento>(res));
}

export function activarPromocion(id: string, activo: boolean) {
  return apiFetch(`/descuentos/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ activo }),
  }).then((res) => json<Descuento>(res));
}

export function eliminarPromocion(id: string) {
  return apiFetch(`/descuentos/${id}`, { method: "DELETE" }).then((res) => json<void>(res));
}

// --- Textos -------------------------------------------------------------------

/** "31/10" de un "AAAA-MM-DD". */
export function diaCorto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** "20% off · hasta el 31/10". */
export function descripcionDescuento(descuento: Pick<DescuentoDeVariante, "etiqueta" | "hastaDia">): string {
  return descuento.hastaDia ? `${descuento.etiqueta} · hasta el ${diaCorto(descuento.hastaDia)}` : descuento.etiqueta;
}

/** De dónde sale el descuento que se está aplicando. */
export function origenDescuento(descuento: Pick<DescuentoDeVariante, "alcance" | "nombre">): string {
  if (descuento.alcance === "producto") return "Descuento del producto";
  const promo = descuento.nombre ? `Promo “${descuento.nombre}”` : "Promo";
  return descuento.alcance === "categoria" ? `${promo} de la categoría` : `${promo} de todo el catálogo`;
}

/** "Del 06/10 al 12/10", "Hasta el 31/10", "Desde el 06/10" o "Sin vencimiento". */
export function vigenciaDe(descuento: Pick<Descuento, "desde" | "hasta">): string {
  if (descuento.desde && descuento.hasta) return `del ${diaCorto(descuento.desde)} al ${diaCorto(descuento.hasta)}`;
  if (descuento.hasta) return `hasta el ${diaCorto(descuento.hasta)}`;
  if (descuento.desde) return `desde el ${diaCorto(descuento.desde)}`;
  return "sin vencimiento";
}

/**
 * Cuánto descuenta por unidad, para la vista previa del formulario. Copia a
 * mano `montoDeDescuento` (api/src/comercio/descuentos.rules.ts): el precio
 * que se cobra lo calcula siempre la API.
 */
export function montoDeDescuento(descuento: Pick<DescuentoAGuardar, "tipo" | "valor">, precioCentavos: number): number {
  if (precioCentavos <= 0 || descuento.valor <= 0) return 0;
  const monto =
    descuento.tipo === "porcentaje"
      ? Math.round((precioCentavos * Math.min(descuento.valor, PORCENTAJE_MAX)) / 100)
      : descuento.valor;
  return monto > 0 && monto < precioCentavos ? monto : 0;
}

/** "$ 10.000 → $ 8.000" o null si con ese precio no descuenta nada. */
export function vistaPrevia(descuento: Pick<DescuentoAGuardar, "tipo" | "valor">, precioCentavos: number) {
  const monto = montoDeDescuento(descuento, precioCentavos);
  if (monto === 0) return null;
  return { lista: formatearCentavos(precioCentavos), final: formatearCentavos(precioCentavos - monto), ahorro: formatearCentavos(monto) };
}

/**
 * Por qué no se puede guardar el descuento tal como está tipeado, o null. Las
 * mismas reglas que `problemaDeDescuento` en la API.
 */
export function problemaDeDescuento(datos: { tipo: TipoDescuento; valor: number | null; desde: string; hasta: string }): string | null {
  if (datos.valor === null || !Number.isInteger(datos.valor) || datos.valor <= 0) {
    return datos.tipo === "porcentaje" ? "El porcentaje tiene que ser un número entero." : "El monto del descuento es inválido.";
  }
  if (datos.tipo === "porcentaje" && datos.valor > PORCENTAJE_MAX) return `El porcentaje va de 1 a ${PORCENTAJE_MAX}.`;
  if (datos.desde && datos.hasta && datos.hasta < datos.desde) return "La fecha “hasta” no puede ser anterior a “desde”.";
  return null;
}
