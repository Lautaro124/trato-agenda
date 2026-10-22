/**
 * Rendimiento de productos y chats (LAU-30): la forma de `GET /performance`
 * (copia a mano de api/src/performance/performance.types.ts) y cómo se
 * muestra. Las definiciones de cada métrica vienen de la API, tal cual.
 */
import { apiFetch } from "@/lib/api";
import { ErrorDeApi, type Moneda } from "@/lib/productos";

export const ETAPAS = ["consulta", "vio_productos", "eligiendo", "lista", "pedido", "cotizado", "pagado"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ETIQUETA_ETAPA: Record<Etapa, string> = {
  consulta: "Consultó",
  vio_productos: "Vio productos",
  eligiendo: "Eligiendo",
  lista: "Listo para comprar",
  pedido: "Hizo el pedido",
  cotizado: "Cotizado",
  pagado: "Pagó",
};

/** `valor` null es "sin datos" (no hubo base), que no es lo mismo que 0 %. */
export type Tasa = { valor: number | null };

export type ConteosConversion = {
  chats: number;
  conPedido: number;
  pedidos: number;
  pagados: number;
  conPago: number;
  chatAPedido: Tasa;
  pedidoAPago: Tasa;
  chatAPago: Tasa;
};

export type EtapaPerformance = {
  etapa: Etapa;
  total: number;
  activos: number;
  estancados: number;
  abandonados: number;
  derivados: number;
};

export type ProductoPerformance = {
  productoId: string;
  codigo: string;
  nombre: string;
  aMedida: boolean;
  vieron: number;
  pidieron: number;
  pagaron: number;
  vioAPidio: Tasa;
  pidioAPago: Tasa;
  unidades: number;
  cobradoCentavos: number;
  cortanEn: Etapa | null;
};

export type Performance = {
  moneda: Moneda;
  rango: { primerDia: string; ultimoDia: string };
  datos: "completos" | "parciales" | "sin_datos";
  registroDesde: string | null;
  definiciones: {
    base: string;
    chatAPedido: string;
    pedidoAPago: string;
    chatAPago: string;
    estancado: string;
    abandonado: string;
    sinDatos: string;
  };
  conversion: ConteosConversion & { anterior: ConteosConversion | null };
  etapas: EtapaPerformance[];
  productos: ProductoPerformance[];
};

export async function obtenerPerformance(filtros: { desde: string; hasta: string; moneda: Moneda }): Promise<Performance> {
  const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
  if (filtros.moneda !== "ARS") params.set("moneda", filtros.moneda);
  const res = await apiFetch(`/performance?${params.toString()}`);
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos cargar el rendimiento.");
  }
  return (await res.json()) as Performance;
}

const PORCENTAJE = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

/** "40 %" o "Sin datos": nunca un 0 % inventado. */
export function porcentaje(tasa: Tasa): string {
  return tasa.valor === null ? "Sin datos" : PORCENTAJE.format(tasa.valor);
}

/**
 * La diferencia con el período anterior en puntos: "+5 pts", "−3 pts", "igual",
 * o null si alguno de los dos no tiene datos.
 */
export function diferenciaEnPuntos(actual: Tasa, anterior: Tasa | undefined): string | null {
  if (actual.valor === null || !anterior || anterior.valor === null) return null;
  const puntos = Math.round((actual.valor - anterior.valor) * 100);
  if (puntos === 0) return "igual que el período anterior";
  return `${puntos > 0 ? "+" : "−"}${Math.abs(puntos)} pts vs. el período anterior`;
}

/** "22/10/2026" a partir de "2026-10-22". */
export function diaLegible(dia: string): string {
  const [anio, mes, d] = dia.split("-");
  return `${Number(d)}/${Number(mes)}/${anio}`;
}

/** La etapa abierta donde más chats se quedaron (estancados o abandonados), o null. */
export function dondeSeQuedan(etapas: EtapaPerformance[]): EtapaPerformance | null {
  let mejor: EtapaPerformance | null = null;
  for (const etapa of etapas) {
    const quietos = etapa.estancados + etapa.abandonados;
    if (quietos > 0 && (!mejor || quietos > mejor.estancados + mejor.abandonados)) mejor = etapa;
  }
  return mejor;
}
