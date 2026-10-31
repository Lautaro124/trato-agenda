/**
 * Condiciones de pago de un comercio que vende (LAU-34), puras como
 * descuentos.rules.ts: planes de cuotas con su recargo y el descuento por
 * pagar en efectivo.
 *
 * - Un plan es una cantidad de cuotas y un recargo en porcentaje sobre el
 *   total (ya con las promos); 0 es "sin interés", como en Mercado Libre.
 * - Las cuotas son en pesos: Mercado Pago no cobra en dólares y no se
 *   convierte nada, así que un pedido en dólares no va en cuotas.
 * - El descuento en efectivo es un descuento más de catálogo que sólo vale
 *   pagando en efectivo: compite con las promos con `mejorDescuento` y nunca
 *   se suma a ellas.
 * - Cada producto puede tener un tope de cuotas (`Producto.cuotasMax`; 1 =
 *   sólo en un pago). En un pedido manda el tope más bajo: el link de Mercado
 *   Pago tiene un único máximo.
 * - Sin condiciones guardadas, el comercio no ofrece ninguna.
 * - El cobro manual (pedidos sin link) puede ser por transferencia a un alias
 *   o por otro canal con un mensaje del dueño. Con cualquiera de los dos, el
 *   asistente le manda eso al cliente y deja el chat en manos del negocio
 *   hasta que el pedido se pague o se cancele. null = se coordina por el chat
 *   y el asistente sigue atendiendo.
 *
 * La web copia los topes y la validación (web/src/lib/condiciones-pago.ts).
 */
import { monedaDe, type Moneda } from './catalogo.rules.js';
import { PORCENTAJE_MAX, type DescuentoParaAplicar } from './descuentos.rules.js';
import { enUnaLinea, esObjeto } from './solicitud.rules.js';

export const FORMAS_DE_PAGO = ['efectivo', 'cuotas'] as const;
export type FormaDePago = (typeof FORMAS_DE_PAGO)[number];

export const MAX_PLANES_CUOTAS = 6;
export const MIN_CUOTAS = 2;
export const MAX_CUOTAS = 24;
export const RECARGO_MAX_PORCENTAJE = 100;

export type PlanCuotas = { cuotas: number; recargoPorcentaje: number };

export const MODOS_COBRO_MANUAL = ['transferencia', 'otro_canal'] as const;
export type ModoCobroManual = (typeof MODOS_COBRO_MANUAL)[number];

export const LARGO_MAX_TITULAR = 80;
/** Lo mismo que un mensaje propio del asistente (mensajes.rules.ts). */
export const LARGO_MAX_MENSAJE_COBRO = 400;
/** Variables que se completan solas en el mensaje de "otro canal". */
export const VARIABLES_MENSAJE_COBRO = ['nombre', 'total', 'detalle'] as const;

/** Alias de Mercado Pago o de un banco: 6 a 20 letras, números, puntos o guiones. */
const ALIAS = /^[a-z0-9.-]{6,20}$/;
/** CBU o CVU: 22 dígitos. */
const CBU = /^\d{22}$/;

export type CobroManual =
  | { modo: 'transferencia'; alias: string; titular: string }
  | { modo: 'otro_canal'; mensaje: string };

export type CondicionesPago = {
  /** Ordenados por cantidad de cuotas. */
  planesCuotas: PlanCuotas[];
  /** 1 a PORCENTAJE_MAX, o null si no hay descuento en efectivo. */
  descuentoEfectivoPorcentaje: number | null;
  /** Cómo se cobra un pedido sin link; null = se coordina por el chat, como siempre. */
  cobroManual: CobroManual | null;
};

export const SIN_CONDICIONES: CondicionesPago = {
  planesCuotas: [],
  descuentoEfectivoPorcentaje: null,
  cobroManual: null,
};

/** Id del descuento sintético del efectivo: no es una fila de `Descuento`. */
export const DESCUENTO_EFECTIVO_ID = 'efectivo';

function esEntero(valor: unknown, min: number, max: number): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= min && valor <= max;
}

export function esFormaDePago(valor: unknown): valor is FormaDePago {
  return typeof valor === 'string' && (FORMAS_DE_PAGO as readonly string[]).includes(valor);
}

/**
 * Valida el cobro manual. Acepta la forma de la pantalla (`{ modo, alias,
 * titular, mensaje }`) y devuelve sólo los campos del modo elegido.
 */
export function normalizarCobroManual(entrada: unknown): { cobroManual: CobroManual | null } | { error: string } {
  if (entrada === null || entrada === undefined) return { cobroManual: null };
  if (!esObjeto(entrada) || !(MODOS_COBRO_MANUAL as readonly unknown[]).includes(entrada.modo)) {
    return { error: 'La forma de cobro sin link no es válida.' };
  }
  if (entrada.modo === 'transferencia') {
    const alias = typeof entrada.alias === 'string' ? entrada.alias.replace(/\s+/g, '').toLowerCase() : '';
    if (!ALIAS.test(alias) && !CBU.test(alias)) {
      return { error: 'El alias tiene que tener de 6 a 20 letras, números, puntos o guiones (o ser un CBU/CVU de 22 dígitos).' };
    }
    const titular = typeof entrada.titular === 'string' ? enUnaLinea(entrada.titular) : '';
    if (!titular) return { error: 'Escribí a nombre de quién está la cuenta.' };
    if (titular.length > LARGO_MAX_TITULAR) {
      return { error: `El titular puede tener como mucho ${LARGO_MAX_TITULAR} caracteres.` };
    }
    return { cobroManual: { modo: 'transferencia', alias, titular } };
  }
  const mensaje = typeof entrada.mensaje === 'string' ? entrada.mensaje.replace(/\r\n?/g, '\n').trim() : '';
  if (!mensaje) return { error: 'Escribí el mensaje que le llega al cliente.' };
  if (mensaje.length > LARGO_MAX_MENSAJE_COBRO) {
    return { error: `El mensaje puede tener como mucho ${LARGO_MAX_MENSAJE_COBRO} caracteres.` };
  }
  const desconocida = [...mensaje.matchAll(/\{(\w+)\}/g)]
    .map((coincidencia) => coincidencia[1])
    .find((variable) => !(VARIABLES_MENSAJE_COBRO as readonly string[]).includes(variable));
  if (desconocida) return { error: `{${desconocida}} no es un dato que se pueda completar en el mensaje.` };
  return { cobroManual: { modo: 'otro_canal', mensaje } };
}

export function normalizarCondiciones(entrada: {
  planesCuotas?: unknown;
  descuentoEfectivoPorcentaje?: unknown;
  cobroManual?: unknown;
}): { condiciones: CondicionesPago } | { error: string } {
  const crudos = entrada.planesCuotas ?? [];
  if (!Array.isArray(crudos)) return { error: 'Los planes de cuotas no son válidos.' };
  if (crudos.length > MAX_PLANES_CUOTAS) return { error: `Podés tener hasta ${MAX_PLANES_CUOTAS} planes de cuotas.` };
  const planes: PlanCuotas[] = [];
  for (const crudo of crudos) {
    if (!esObjeto(crudo) || !esEntero(crudo.cuotas, MIN_CUOTAS, MAX_CUOTAS)) {
      return { error: `Las cuotas tienen que ser de ${MIN_CUOTAS} a ${MAX_CUOTAS}.` };
    }
    if (!esEntero(crudo.recargoPorcentaje, 0, RECARGO_MAX_PORCENTAJE)) {
      return { error: `El recargo tiene que ser de 0% a ${RECARGO_MAX_PORCENTAJE}%.` };
    }
    if (planes.some((plan) => plan.cuotas === crudo.cuotas)) {
      return { error: `Hay dos planes de ${crudo.cuotas as number} cuotas: dejá uno.` };
    }
    planes.push({ cuotas: crudo.cuotas, recargoPorcentaje: crudo.recargoPorcentaje });
  }
  const efectivo = entrada.descuentoEfectivoPorcentaje ?? null;
  if (efectivo !== null && !esEntero(efectivo, 1, PORCENTAJE_MAX)) {
    return { error: `El descuento en efectivo tiene que ser de 1% a ${PORCENTAJE_MAX}%.` };
  }
  const cobro = normalizarCobroManual(entrada.cobroManual);
  if ('error' in cobro) return cobro;
  return {
    condiciones: {
      planesCuotas: planes.sort((a, b) => a.cuotas - b.cuotas),
      descuentoEfectivoPorcentaje: efectivo,
      cobroManual: cobro.cobroManual,
    },
  };
}

/** Las columnas de `CondicionesPago` del cobro manual (se guardan planas). */
export type FilaCobroManual = {
  cobroManual: string | null;
  aliasTransferencia: string | null;
  titularTransferencia: string | null;
  mensajeCobroManual: string | null;
};

export function filaDeCobroManual(cobro: CobroManual | null): FilaCobroManual {
  return {
    cobroManual: cobro?.modo ?? null,
    aliasTransferencia: cobro?.modo === 'transferencia' ? cobro.alias : null,
    titularTransferencia: cobro?.modo === 'transferencia' ? cobro.titular : null,
    mensajeCobroManual: cobro?.modo === 'otro_canal' ? cobro.mensaje : null,
  };
}

/**
 * Lee la fila guardada sin confiar en la forma: lo que no cierra es como no
 * ofrecer nada. Un cobro manual roto no se lleva puestas las cuotas: queda
 * como "coordinar por el chat".
 */
export function leerCondiciones(
  fila: ({ planesCuotas: unknown; descuentoEfectivoPorcentaje: number | null } & Partial<FilaCobroManual>) | null,
): CondicionesPago {
  if (!fila) return SIN_CONDICIONES;
  const resultado = normalizarCondiciones({
    planesCuotas: fila.planesCuotas,
    descuentoEfectivoPorcentaje: fila.descuentoEfectivoPorcentaje,
  });
  if (!('condiciones' in resultado)) return SIN_CONDICIONES;
  const cobro = fila.cobroManual
    ? normalizarCobroManual({
        modo: fila.cobroManual,
        alias: fila.aliasTransferencia,
        titular: fila.titularTransferencia,
        mensaje: fila.mensajeCobroManual,
      })
    : { cobroManual: null };
  return { ...resultado.condiciones, cobroManual: 'cobroManual' in cobro ? cobro.cobroManual : null };
}

export function hayCondiciones(condiciones: CondicionesPago): boolean {
  return condiciones.planesCuotas.length > 0 || condiciones.descuentoEfectivoPorcentaje !== null;
}

/** El tope de un pedido: el más bajo de sus productos, o null si ninguno tiene. */
export function topeDelPedido(topes: Array<number | null>): number | null {
  const conTope = topes.filter((tope): tope is number => tope !== null);
  return conTope.length > 0 ? Math.min(...conTope) : null;
}

/** Los planes que se pueden ofrecer en esa moneda y con ese tope: ninguno en dólares. */
export function planesEn(condiciones: CondicionesPago, moneda: string, tope: number | null = null): PlanCuotas[] {
  if (monedaDe(moneda) !== 'ARS') return [];
  return condiciones.planesCuotas.filter((plan) => tope === null || plan.cuotas <= tope);
}

/**
 * El máximo de cuotas del link de un pedido sin plan elegido, o null si no se
 * limita. Con planes, las cuotas van sólo por ellos (con su recargo): el link
 * es en un pago. Sin planes, vale el tope de los productos.
 */
export function maxCuotasSinPlan(condiciones: CondicionesPago, tope: number | null): number | null {
  return condiciones.planesCuotas.length > 0 ? 1 : tope;
}

/** Lo que se suma al total por pagar en ese plan. */
export function recargoDe(subtotalCentavos: number, plan: PlanCuotas): number {
  return Math.round((subtotalCentavos * plan.recargoPorcentaje) / 100);
}

/** El valor de cada cuota, redondeado para arriba para que N cuotas cubran el total. */
export function valorDeCuota(totalCentavos: number, cuotas: number): number {
  return Math.ceil(totalCentavos / cuotas);
}

/** El descuento en efectivo como un descuento de catálogo, para `mejorDescuento`. */
export function descuentoEfectivo(condiciones: CondicionesPago): DescuentoParaAplicar | null {
  if (condiciones.descuentoEfectivoPorcentaje === null) return null;
  return {
    id: DESCUENTO_EFECTIVO_ID,
    productoId: null,
    categoria: null,
    nombre: 'Pago en efectivo',
    tipo: 'porcentaje',
    valor: condiciones.descuentoEfectivoPorcentaje,
    activo: true,
    desde: null,
    hasta: null,
  };
}

/**
 * Por qué no se puede pagar así, con un texto que el asistente puede usar, o
 * null si se puede. Sin forma de pago es el contado de siempre.
 */
export function problemaDeFormaDePago(
  condiciones: CondicionesPago,
  formaPago: FormaDePago | null,
  cuotas: number | null,
  moneda: Moneda,
  tope: number | null = null,
): string | null {
  if (formaPago === 'efectivo' && condiciones.descuentoEfectivoPorcentaje === null) {
    return 'El negocio no tiene descuento por pago en efectivo: creá el pedido sin forma de pago (al precio de siempre).';
  }
  if (formaPago !== 'cuotas') return null;
  if (moneda !== 'ARS') return 'Un pedido en dólares no se paga en cuotas: creá el pedido sin forma de pago.';
  const planes = condiciones.planesCuotas;
  if (planes.length === 0) return 'El negocio no ofrece pago en cuotas: creá el pedido sin forma de pago.';
  const posibles = planesEn(condiciones, moneda, tope);
  if (posibles.length === 0) {
    return (
      'Con estos productos no hay plan de cuotas: alguno se vende en un pago o con menos cuotas. Creá el pedido ' +
      'sin forma de pago o sacá ese producto.'
    );
  }
  if (cuotas !== null && posibles.some((plan) => plan.cuotas === cuotas)) return null;
  const opciones = `Los que hay son de ${posibles.map((plan) => plan.cuotas).join(', ')} cuotas.`;
  return planes.some((plan) => plan.cuotas === cuotas)
    ? `Con estos productos el máximo es ${tope as number} cuotas. ${opciones}`
    : `Ese plan de cuotas no existe. ${opciones}`;
}
