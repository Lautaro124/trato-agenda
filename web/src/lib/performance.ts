/**
 * Rendimiento de productos y chats (LAU-30): la forma de `GET /performance`
 * (copia a mano de api/src/performance/performance.types.ts) y cómo se
 * muestra. Las definiciones de cada métrica vienen de la API, tal cual.
 */
import { apiFetch } from "@/lib/api";
import { ErrorDeApi, type Moneda } from "@/lib/productos";
import { diaCorto } from "@/lib/ventas";

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
const PARES_ZONA = [
  ["caba", "Ciudad de Buenos Aires"],
  ["amba", "CABA o Gran Buenos Aires"],
  ["buenos_aires", "Buenos Aires"],
  ["catamarca", "Catamarca"],
  ["chaco", "Chaco"],
  ["chubut", "Chubut"],
  ["cordoba", "Córdoba"],
  ["corrientes", "Corrientes"],
  ["entre_rios", "Entre Ríos"],
  ["formosa", "Formosa"],
  ["jujuy", "Jujuy"],
  ["la_pampa", "La Pampa"],
  ["la_rioja", "La Rioja"],
  ["mendoza", "Mendoza"],
  ["misiones", "Misiones"],
  ["neuquen", "Neuquén"],
  ["rio_negro", "Río Negro"],
  ["salta", "Salta"],
  ["san_juan", "San Juan"],
  ["san_luis", "San Luis"],
  ["santa_cruz", "Santa Cruz"],
  ["santa_fe", "Santa Fe"],
  ["santiago_del_estero", "Santiago del Estero"],
  ["tierra_del_fuego", "Tierra del Fuego"],
  ["tucuman", "Tucumán"],
] as const;
export type ClaveZona = (typeof PARES_ZONA)[number][0];
export const ZONAS = Object.fromEntries(PARES_ZONA) as Record<ClaveZona, string>;
export type FiltroZona = ClaveZona | "sin_zona";

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
  cobradoCentavos: number;
};

export type ConversionPerformance = ConteosConversion & {
  chatAPedido: Tasa;
  pedidoAPago: Tasa;
  chatAPago: Tasa;
};

/** Los chats que escribieron por primera vez ese día, con sus pedidos y pagos. */
export type DiaPerformance = ConteosConversion & { dia: string };

export type Cobertura = "completos" | "parciales" | "sin_datos";

export type Rango = { primerDia: string; ultimoDia: string };

type Conteo<K extends string> = Record<K, number>;
type Tasas<K extends string> = Record<K, Tasa>;

export type EtapaPerformance = Conteo<"total" | "activos" | "estancados" | "abandonados" | "derivados"> & { etapa: Etapa };

export type ProductoPerformance = Conteo<"vieron" | "pidieron" | "pagaron" | "unidades" | "cobradoCentavos"> &
  Tasas<"vioAPidio" | "pidioAPago"> & {
    productoId: string;
    codigo: string;
    nombre: string;
    aMedida: boolean;
    cortanEn: Etapa | null;
  };

/** `inferidas`: cuántos chats tienen la zona inferida por la característica del celular. */
export type ZonaPerformance = Conteo<"chats" | "inferidas" | "conPedido" | "conPago"> &
  Tasas<"chatAPedido" | "chatAPago"> & { zona: FiltroZona; nombre: string };

export type Performance = {
  moneda: Moneda;
  zona: FiltroZona | null;
  rango: Rango;
  datos: Cobertura;
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
    cobrado: string;
    porDia: string;
    comparacion: string;
  };
  conversion: ConversionPerformance;
  /** Un elemento por día del período; suman `conversion`. */
  porDia: DiaPerformance[];
  /** El período anterior de igual largo: sin conteos si es previo al registro. */
  anterior: {
    rango: Rango;
    datos: Cobertura;
    conversion: ConversionPerformance | null;
    porDia: DiaPerformance[] | null;
  };
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
 * Cómo cambió una métrica contra el período anterior: `texto` es la etiqueta
 * corta y `descripcion`, lo que se lee en voz alta.
 */
export type Variacion = { tono: "sube" | "baja" | "igual" | "nuevo"; texto: string; descripcion: string };

/** La diferencia entre dos tasas, en puntos; null si alguna no tiene datos (no hay nada que comparar). */
export function diferenciaEnPuntos(actual: Tasa, anterior: Tasa | undefined): Variacion | null {
  if (actual.valor === null || !anterior || anterior.valor === null) return null;
  const puntos = Math.round((actual.valor - anterior.valor) * 100);
  if (puntos === 0) return { tono: "igual", texto: "igual", descripcion: "igual que el período anterior" };
  const sube = puntos > 0;
  const n = Math.abs(puntos);
  return {
    tono: sube ? "sube" : "baja",
    texto: `${sube ? "▲" : "▼"} ${n} pts`,
    descripcion: `${n} ${n === 1 ? "punto" : "puntos"} ${sube ? "más" : "menos"} que el período anterior`,
  };
}

/**
 * El cambio de una cantidad, en porcentaje. Contra 0 no hay porcentaje que
 * sirva (sería infinito): se dice "nuevo".
 */
export function variacionPorcentual(actual: number, anterior: number): Variacion {
  if (actual === anterior) return { tono: "igual", texto: "igual", descripcion: "igual que el período anterior" };
  if (anterior === 0) return { tono: "nuevo", texto: "Nuevo · antes 0", descripcion: "en el período anterior fue 0" };
  const cambio = Math.round(((actual - anterior) / anterior) * 100);
  if (cambio === 0) return { tono: "igual", texto: "≈ igual", descripcion: "casi igual que el período anterior" };
  const sube = cambio > 0;
  return {
    tono: sube ? "sube" : "baja",
    texto: `${sube ? "▲" : "▼"} ${Math.abs(cambio)} %`,
    descripcion: `${Math.abs(cambio)} % ${sube ? "más" : "menos"} que el período anterior`,
  };
}

/** "30/9–29/10" para las etiquetas cortas de cada barra. */
export function rangoCorto(rango: Rango): string {
  return rango.primerDia === rango.ultimoDia ? diaCorto(rango.primerDia) : `${diaCorto(rango.primerDia)}–${diaCorto(rango.ultimoDia)}`;
}

/** "30/9 al 29/10", o "29/10" si es un solo día. */
export function rangoLegible(rango: Rango): string {
  return rango.primerDia === rango.ultimoDia ? diaCorto(rango.primerDia) : `${diaCorto(rango.primerDia)} al ${diaCorto(rango.ultimoDia)}`;
}

/** "22/10/2026" a partir de "2026-10-22". */
export function diaLegible(dia: string): string {
  const [anio, mes, d] = dia.split("-");
  return `${Number(d)}/${Number(mes)}/${anio}`;
}

const HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "17:42", en la hora del negocio. */
export function horaLegible(instante: number): string {
  return HORA.format(new Date(instante));
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
