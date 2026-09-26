import { apiFetch } from "./api";
import { ErrorDeApi } from "./productos";

export type EstadoVenta = "pendiente_pago" | "pagada" | "cancelada" | "vencida";

/** Espejo de `VentaPublica` en la API. */
export type Venta = {
  id: string;
  estado: EstadoVenta;
  medioPago: "mercadopago" | "manual";
  nombreCliente: string | null;
  telefonoCliente: string | null;
  totalCentavos: number;
  moneda: string;
  reservaVenceAt: string;
  linkPago: string | null;
  pagadaAt: string | null;
  canceladaAt: string | null;
  sinStockAlPagar: boolean;
  /** Pedido del chat de prueba del Home: no cuenta en los totales salvo que se pida. */
  dePrueba: boolean;
  createdAt: string;
  mpPaymentId: string | null;
  items: Array<{
    codigo: string;
    nombreProducto: string;
    nombreVariante: string;
    cantidad: number;
    precioUnitarioCentavos: number;
    subtotalCentavos: number;
  }>;
};

export type Totales = {
  cobradoCentavos: number;
  pagadas: number;
  ticketPromedioCentavos: number;
  pendienteCentavos: number;
  pendientes: number;
};

export type ListadoVentas = {
  ventas: Venta[];
  total: number;
  pagina: number;
  porPagina: number;
  totales: Totales;
  rango: { primerDia: string; ultimoDia: string };
};

export type ResumenVentas = {
  rango: { primerDia: string; ultimoDia: string };
  porDia: Array<{ dia: string; cobradoCentavos: number; ventas: number }>;
  topProductos: Array<{ codigo: string; nombreProducto: string; unidades: number; cobradoCentavos: number }>;
};

export type FiltrosVentas = {
  desde: string;
  hasta: string;
  estado?: EstadoVenta;
  q?: string;
  incluirPrueba?: boolean;
  pagina?: number;
};

export const ETIQUETA_ESTADO: Record<EstadoVenta, string> = {
  pendiente_pago: "Pendiente de pago",
  pagada: "Pagada",
  cancelada: "Cancelada",
  vencida: "Vencida",
};

function query(filtros: FiltrosVentas): string {
  const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.q?.trim()) params.set("q", filtros.q.trim());
  if (filtros.incluirPrueba) params.set("incluirPrueba", "true");
  if (filtros.pagina && filtros.pagina > 1) params.set("pagina", String(filtros.pagina));
  return params.toString();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

export function listarVentas(filtros: FiltrosVentas): Promise<ListadoVentas> {
  return apiFetch(`/ventas?${query(filtros)}`).then((res) => json<ListadoVentas>(res));
}

export function resumenVentas(filtros: FiltrosVentas): Promise<ResumenVentas> {
  const { desde, hasta, incluirPrueba } = filtros;
  return apiFetch(`/ventas/resumen?${query({ desde, hasta, incluirPrueba })}`).then((res) => json<ResumenVentas>(res));
}

export function obtenerVenta(id: string): Promise<Venta> {
  return apiFetch(`/ventas/${encodeURIComponent(id)}`).then((res) => json<Venta>(res));
}

export function marcarPagada(id: string): Promise<Venta> {
  return apiFetch(`/ventas/${encodeURIComponent(id)}/pagada`, { method: "POST" }).then((res) => json<Venta>(res));
}

export function cancelarVenta(id: string): Promise<Venta> {
  return apiFetch(`/ventas/${encodeURIComponent(id)}/cancelar`, { method: "POST" }).then((res) => json<Venta>(res));
}

/** Descarga el CSV con los mismos filtros que la pantalla (sin paginar). */
export async function descargarCsv(filtros: FiltrosVentas): Promise<void> {
  const res = await apiFetch(`/ventas/export.csv?${query({ ...filtros, pagina: undefined })}`);
  if (!res.ok) throw new ErrorDeApi("No pudimos exportar las ventas.");
  const url = URL.createObjectURL(await res.blob());
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `ventas-${filtros.desde}-a-${filtros.hasta}.csv`;
  enlace.click();
  URL.revokeObjectURL(url);
}

// --- Fechas en la zona del negocio ------------------------------------------------

const ZONA = "America/Argentina/Buenos_Aires";
const CLAVE_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA });

/** "YYYY-MM-DD" de un instante en Buenos Aires. */
export function claveDia(fecha: Date): string {
  return CLAVE_DIA.format(fecha);
}

/** Suma días a un "YYYY-MM-DD" (a mediodía, así el cambio de día nunca depende del huso). */
export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00-03:00`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return claveDia(fecha);
}

export type Periodo = "hoy" | "7" | "30" | "mes" | "personalizado";

export function rangoDePeriodo(periodo: Exclude<Periodo, "personalizado">, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hoy = claveDia(ahora);
  if (periodo === "hoy") return { desde: hoy, hasta: hoy };
  if (periodo === "mes") return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  return { desde: sumarDias(hoy, -(Number(periodo) - 1)), hasta: hoy };
}

const FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "26/9, 17:42". */
export function fechaCorta(iso: string): string {
  return FECHA_CORTA.format(new Date(iso));
}

/** "26/9" de un "YYYY-MM-DD". */
export function diaCorto(dia: string): string {
  return `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;
}

const DIA_SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, weekday: "short" });

/** "sáb 26/9" de un "YYYY-MM-DD". */
export function diaConSemana(dia: string): string {
  return `${DIA_SEMANA.format(new Date(`${dia}T12:00:00-03:00`)).replace(".", "")} ${diaCorto(dia)}`;
}

const COMPACTO = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

/** "$ 12,9 M" para los montos grandes de los ejes y las tarjetas. */
export function pesosCompactos(centavos: number): string {
  return `$ ${COMPACTO.format(centavos / 100)}`;
}
