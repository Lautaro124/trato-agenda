/**
 * Reglas de lectura del módulo de performance (LAU-30), como funciones puras:
 * tasas que distinguen "sin datos" de 0 %, el estado de un chat abierto, el
 * período anterior para comparar y qué tan cubierto está un período por el
 * registro. Definiciones en docs/performance.md.
 *
 * La base son los chats nuevos del período (`EtapaChat.createdAt`): no
 * depende de los mensajes, que se borran a los 90 días.
 */
import { diasEntre, type Rango } from '../comercio/historico.rules.js';
import { claveDia, fechaEnDia } from '../conversation/graph/agenda-rules.js';
import { ETAPAS, type Etapa } from './etapas.rules.js';

/** Sin mensajes hace esto o más: estancado. */
export const HORAS_ESTANCADO = 48;
/** Sin mensajes hace más que esto: abandonado. */
export const DIAS_ABANDONADO = 7;
/** Productos que devuelve la lectura, los de más interés primero. */
export const MAX_PRODUCTOS_PERFORMANCE = 50;

const MS_POR_HORA = 60 * 60 * 1000;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** `valor` null es "sin datos" (base 0), que no es lo mismo que 0 %. */
export type Tasa = { valor: number | null };

export function tasa(numerador: number, base: number): Tasa {
  if (base <= 0) return { valor: null };
  return { valor: Math.round((numerador / base) * 10_000) / 10_000 };
}

export const ESTADOS_CHAT = ['activo', 'estancado', 'abandonado', 'cerrado'] as const;
export type EstadoChat = (typeof ESTADOS_CHAT)[number];

/** Un chat pagado está cerrado; uno abierto, según cuánto hace que no escribe. */
export function estadoDeChat(etapa: Etapa, ultimaActividadAt: Date, ahora: Date): EstadoChat {
  if (etapa === 'pagado') return 'cerrado';
  const quieto = ahora.getTime() - ultimaActividadAt.getTime();
  if (quieto > DIAS_ABANDONADO * MS_POR_DIA) return 'abandonado';
  if (quieto >= HORAS_ESTANCADO * MS_POR_HORA) return 'estancado';
  return 'activo';
}

/** El período del mismo largo que termina justo antes del pedido. */
export function rangoAnterior(rango: Rango): Rango {
  const dias = diasEntre(rango.primerDia, rango.ultimoDia).length;
  const ultimoDia = claveDia(new Date(fechaEnDia(rango.primerDia, '12:00').getTime() - MS_POR_DIA));
  const primerDia = claveDia(new Date(fechaEnDia(ultimoDia, '12:00').getTime() - (dias - 1) * MS_POR_DIA));
  return { primerDia, ultimoDia, desde: fechaEnDia(primerDia, '00:00'), hasta: rango.desde };
}

export type Cobertura = 'completos' | 'parciales' | 'sin_datos';

/**
 * Las métricas existen desde el primer chat registrado de la cuenta: un
 * período que termina antes no tiene datos, y uno que empieza antes los
 * tiene a medias.
 */
export function cobertura(rango: Rango, primerRegistro: Date | null): Cobertura {
  if (!primerRegistro || rango.hasta.getTime() <= primerRegistro.getTime()) return 'sin_datos';
  return rango.desde.getTime() < primerRegistro.getTime() ? 'parciales' : 'completos';
}

/**
 * Dónde se quedan los chats de un producto: la etapa con más chats que no
 * llegaron a pagar. Ante un empate, la más temprana (es la que más pierde).
 */
export function etapaDondeCortan(conteos: Partial<Record<Etapa, number>>): Etapa | null {
  let mejor: Etapa | null = null;
  for (const etapa of ETAPAS) {
    if (etapa === 'pagado') continue;
    const cantidad = conteos[etapa] ?? 0;
    if (cantidad > 0 && (mejor === null || cantidad > (conteos[mejor] ?? 0))) mejor = etapa;
  }
  return mejor;
}

/** Lo que la pantalla muestra al lado de cada métrica, tal cual. */
export const DEFINICIONES = {
  base: 'Chats nuevos del período: los que escribieron por primera vez entre esas fechas. Sus pedidos y pagos cuentan aunque lleguen después.',
  chatAPedido: 'De los chats nuevos del período, cuántos hicieron un pedido o una solicitud a medida.',
  pedidoAPago: 'De los pedidos de esos chats, cuántos se pagaron (por Mercado Pago o marcados a mano).',
  chatAPago: 'De los chats nuevos del período, cuántos terminaron en un pago.',
  estancado: `Un chat sin pagar está estancado si no escribe hace ${HORAS_ESTANCADO} horas o más.`,
  abandonado: `Un chat sin pagar está abandonado si no escribe hace más de ${DIAS_ABANDONADO} días.`,
  sinDatos: 'Sin datos: no hubo chats para calcularlo, o el período es anterior al registro. No es lo mismo que 0 %.',
} as const;
