import { IsIn, IsOptional, Matches } from 'class-validator';
import { MONEDAS, type Moneda } from '../comercio/catalogo.rules.js';
import type { Etapa } from './etapas.rules.js';
import type { Cobertura, DEFINICIONES, Tasa } from './lectura.rules.js';
import type { Tema } from './preguntas.rules.js';
import { SIN_ZONA, ZONAS, type Zona } from './zona.rules.js';

/** Las zonas por las que se puede filtrar: cada provincia, o los chats sin zona. */
export const FILTROS_ZONA = [...(Object.keys(ZONAS) as Zona[]), SIN_ZONA] as const;
export type FiltroZona = Zona | typeof SIN_ZONA;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros de `GET /performance`. Sin fechas, los últimos 30 días (como el histórico). */
export class FiltrosPerformanceQuery {
  @IsOptional()
  @Matches(DIA, { message: 'desde tiene que ser AAAA-MM-DD.' })
  desde?: string;

  @IsOptional()
  @Matches(DIA, { message: 'hasta tiene que ser AAAA-MM-DD.' })
  hasta?: string;

  /** La moneda de los pedidos, pagos y montos. Por defecto, pesos; nunca se mezclan. */
  @IsOptional()
  @IsIn(MONEDAS)
  moneda?: Moneda;

  /** Sólo los chats de esa zona (todas las métricas). Sin ella, todos. */
  @IsOptional()
  @IsIn(FILTROS_ZONA)
  zona?: FiltroZona;
}

export type ConteosConversion = {
  /** Chats nuevos del período. */
  chats: number;
  /** De esos, los que hicieron un pedido o una solicitud. */
  conPedido: number;
  /** Pedidos de esos chats, en la moneda pedida. */
  pedidos: number;
  /** De esos pedidos, los pagados. */
  pagados: number;
  /** Chats nuevos que terminaron en un pago. */
  conPago: number;
};

export type Conversion = ConteosConversion & {
  chatAPedido: Tasa;
  pedidoAPago: Tasa;
  chatAPago: Tasa;
  /** El período anterior de igual largo; null si no tiene datos. */
  anterior: (ConteosConversion & { chatAPedido: Tasa; pedidoAPago: Tasa; chatAPago: Tasa }) | null;
};

export type EtapaPublica = {
  etapa: Etapa;
  total: number;
  activos: number;
  estancados: number;
  abandonados: number;
  /** Pasaron a una persona. */
  derivados: number;
};

export type ProductoPerformance = {
  productoId: string;
  codigo: string;
  nombre: string;
  aMedida: boolean;
  /** Chats nuevos del período que lo vieron, lo pidieron y lo pagaron. */
  vieron: number;
  pidieron: number;
  pagaron: number;
  vioAPidio: Tasa;
  pidioAPago: Tasa;
  unidades: number;
  cobradoCentavos: number;
  /** La etapa donde más se quedan los chats que lo vieron y no pagaron. */
  cortanEn: Etapa | null;
};

export type ZonaPerformance = {
  zona: FiltroZona;
  nombre: string;
  chats: number;
  /** De esos chats, cuántos tienen la zona inferida por la característica (no la dio el cliente). */
  inferidas: number;
  conPedido: number;
  conPago: number;
  chatAPedido: Tasa;
  chatAPago: Tasa;
};

export type PreguntasPerformance = {
  /** Chats nuevos del período ya clasificados, de `chats`. */
  analizados: number;
  chats: number;
  porTema: Array<{ tema: Tema; nombre: string; total: number; sinResolver: number; ejemplos: string[] }>;
  porProducto: Array<{ productoId: string; nombre: string; total: number; sinResolver: number; temaPrincipal: Tema }>;
  /** Qué preguntaron los chats que no pagaron, según la etapa en la que quedaron. */
  dondeSeQuedan: Array<{ etapa: Etapa; tema: Tema; total: number }>;
};

export type PerformancePublica = {
  moneda: Moneda;
  /** La zona por la que se filtró, o null si son todas. */
  zona: FiltroZona | null;
  rango: { primerDia: string; ultimoDia: string };
  /** Qué tanto cubre el registro al período: arranca con el primer chat registrado de la cuenta. */
  datos: Cobertura;
  /** Día del primer chat registrado, o null si todavía no hay ninguno. */
  registroDesde: string | null;
  definiciones: typeof DEFINICIONES;
  conversion: Conversion;
  etapas: EtapaPublica[];
  productos: ProductoPerformance[];
  /** Los chats nuevos del período por zona (siempre todas, aunque se filtre por una). */
  zonas: ZonaPerformance[];
  /** Las preguntas de los clientes, clasificadas por el modelo (inferencia). */
  preguntas: PreguntasPerformance;
};
