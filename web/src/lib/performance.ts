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

/** Copia a mano de ZONAS en api/src/performance/zona.rules.ts. */
export const ZONAS = {
  caba: "Ciudad de Buenos Aires",
  amba: "CABA o Gran Buenos Aires",
  buenos_aires: "Buenos Aires",
  catamarca: "Catamarca",
  chaco: "Chaco",
  chubut: "Chubut",
  cordoba: "Córdoba",
  corrientes: "Corrientes",
  entre_rios: "Entre Ríos",
  formosa: "Formosa",
  jujuy: "Jujuy",
  la_pampa: "La Pampa",
  la_rioja: "La Rioja",
  mendoza: "Mendoza",
  misiones: "Misiones",
  neuquen: "Neuquén",
  rio_negro: "Río Negro",
  salta: "Salta",
  san_juan: "San Juan",
  san_luis: "San Luis",
  santa_cruz: "Santa Cruz",
  santa_fe: "Santa Fe",
  santiago_del_estero: "Santiago del Estero",
  tierra_del_fuego: "Tierra del Fuego",
  tucuman: "Tucumán",
} as const;
export type FiltroZona = keyof typeof ZONAS | "sin_zona";

/** Copia a mano de TEMAS en api/src/performance/preguntas.rules.ts. */
export const TEMAS = {
  precio: "Precio",
  envio: "Envío",
  stock: "Stock y variantes",
  medidas: "Medidas y materiales",
  pago: "Formas de pago",
  plazos: "Plazos de entrega",
  local: "Local y retiro",
  otro: "Otro",
} as const;
export type Tema = keyof typeof TEMAS;

export type PreguntasPerformance = {
  analizados: number;
  chats: number;
  porTema: Array<{ tema: Tema; nombre: string; total: number; sinResolver: number; ejemplos: string[] }>;
  porProducto: Array<{ productoId: string; nombre: string; total: number; sinResolver: number; temaPrincipal: Tema }>;
  dondeSeQuedan: Array<{ etapa: Etapa; tema: Tema; total: number }>;
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

export type ZonaPerformance = {
  zona: FiltroZona;
  nombre: string;
  chats: number;
  /** Cuántos tienen la zona inferida por la característica del celular. */
  inferidas: number;
  conPedido: number;
  conPago: number;
  chatAPedido: Tasa;
  chatAPago: Tasa;
};

export type Performance = {
  moneda: Moneda;
  zona: FiltroZona | null;
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
    preguntas: string;
    zona: string;
  };
  conversion: ConteosConversion & { anterior: ConteosConversion | null };
  etapas: EtapaPerformance[];
  productos: ProductoPerformance[];
  zonas: ZonaPerformance[];
  preguntas: PreguntasPerformance;
};

export type FiltrosPerformance = { desde: string; hasta: string; moneda: Moneda; zona: FiltroZona | "" };

/** Lo que dice la falla genérica: la pantalla lo reconoce para mostrar su texto tranquilizador. */
export const ERROR_DE_CARGA = "No pudimos cargar el rendimiento.";

export async function obtenerPerformance(filtros: FiltrosPerformance): Promise<Performance> {
  const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
  if (filtros.moneda !== "ARS") params.set("moneda", filtros.moneda);
  if (filtros.zona) params.set("zona", filtros.zona);
  const res = await apiFetch(`/performance?${params.toString()}`);
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : ERROR_DE_CARGA);
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
