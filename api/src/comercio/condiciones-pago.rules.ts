/**
 * Condiciones de pago de un comercio que vende (LAU-34), puras como
 * descuentos.rules.ts: las cuotas de cada producto, el descuento por pagar en
 * efectivo y el cobro sin link.
 *
 * - Las cuotas son de cada producto (`Producto.cuotas`); sin ellas, el
 *   producto se vende en un pago. El dueño elige con qué cantidades se vende
 *   y cómo se cobran:
 *   - `recargo`: un mismo porcentaje para todas, sobre el precio con las
 *     promos; 0 es "sin interés", como en Mercado Libre.
 *   - `precios`: el total de una unidad en cada cantidad, que no puede ser
 *     menor que el precio. Un plan que quedó por debajo (porque el precio
 *     subió) no se ofrece hasta que el dueño lo corrija.
 * - Un pedido con varios productos sólo va en las cuotas que tienen todos: el
 *   link de Mercado Pago tiene una sola cantidad. Cada renglón suma su recargo.
 * - Las cuotas son en pesos: Mercado Pago no cobra en dólares y no se
 *   convierte nada, así que un producto en dólares no va en cuotas.
 * - El descuento en efectivo (de la cuenta) es un descuento más de catálogo
 *   que sólo vale pagando en efectivo: compite con las promos con
 *   `mejorDescuento` y nunca se suma a ellas.
 * - El cobro manual (pedidos sin link) puede ser por transferencia a un alias
 *   o por otro canal con un mensaje del dueño. Con cualquiera de los dos, el
 *   asistente le manda eso al cliente y deja el chat en manos del negocio
 *   hasta que el dueño se lo devuelva al asistente (LAU-81). null = se coordina por el chat
 *   y el asistente sigue atendiendo.
 *
 * La web copia los topes y la validación (web/src/lib/condiciones-pago.ts).
 */
import { enUnaLinea, esObjeto, formatearMonto, monedaDe, PRECIO_MAX_PESOS, type Moneda } from './catalogo.rules.js';
import { PORCENTAJE_MAX, type DescuentoParaAplicar } from './descuentos.rules.js';

export const FORMAS_DE_PAGO = ['efectivo', 'cuotas'] as const;
export type FormaDePago = (typeof FORMAS_DE_PAGO)[number];

export const MIN_CUOTAS = 2;
export const MAX_CUOTAS = 24;
export const RECARGO_MAX_PORCENTAJE = 100;

export const MODOS_CUOTAS = ['recargo', 'precios'] as const;
export type ModoCuotas = (typeof MODOS_CUOTAS)[number];

/** Las cuotas de un producto. Las cantidades van ordenadas y sin repetir. */
export type CuotasProducto =
  | { modo: 'recargo'; recargoPorcentaje: number; planes: number[] }
  | { modo: 'precios'; planes: Array<{ cuotas: number; totalCentavos: number }> };

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
  /** 1 a PORCENTAJE_MAX, o null si no hay descuento en efectivo. */
  descuentoEfectivoPorcentaje: number | null;
  /** Cómo se cobra un pedido sin link; null = se coordina por el chat, como siempre. */
  cobroManual: CobroManual | null;
};

export const SIN_CONDICIONES: CondicionesPago = {
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
  descuentoEfectivoPorcentaje?: unknown;
  cobroManual?: unknown;
}): { condiciones: CondicionesPago } | { error: string } {
  const efectivo = entrada.descuentoEfectivoPorcentaje ?? null;
  if (efectivo !== null && !esEntero(efectivo, 1, PORCENTAJE_MAX)) {
    return { error: `El descuento en efectivo tiene que ser de 1% a ${PORCENTAJE_MAX}%.` };
  }
  const cobro = normalizarCobroManual(entrada.cobroManual);
  if ('error' in cobro) return cobro;
  return { condiciones: { descuentoEfectivoPorcentaje: efectivo, cobroManual: cobro.cobroManual } };
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
 * ofrecer nada. Un cobro manual roto no se lleva puestas las demás: queda
 * como "coordinar por el chat".
 */
export function leerCondiciones(
  fila: ({ descuentoEfectivoPorcentaje: number | null } & Partial<FilaCobroManual>) | null,
): CondicionesPago {
  if (!fila) return SIN_CONDICIONES;
  const resultado = normalizarCondiciones({ descuentoEfectivoPorcentaje: fila.descuentoEfectivoPorcentaje });
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

// --- Cuotas de un producto ------------------------------------------------------

/**
 * Valida las cuotas de un producto contra su precio y su moneda. Acepta la
 * forma de la pantalla y devuelve sólo los campos del modo elegido; null o
 * ausente = se vende en un pago.
 */
export function normalizarCuotasProducto(
  entrada: unknown,
  precioCentavos: number,
  moneda: Moneda,
): { cuotas: CuotasProducto | null } | { error: string } {
  if (entrada === null || entrada === undefined) return { cuotas: null };
  if (!esObjeto(entrada) || !(MODOS_CUOTAS as readonly unknown[]).includes(entrada.modo) || !Array.isArray(entrada.planes)) {
    return { error: 'Las cuotas no son válidas.' };
  }
  if (moneda !== 'ARS') return { error: 'Un producto en dólares no se vende en cuotas: Mercado Pago cobra en pesos.' };
  if (entrada.planes.length === 0) return { error: 'Elegí en cuántas cuotas se vende, o dejalo en un pago.' };
  const vistas = new Set<number>();
  const cantidadDe = (crudo: unknown): number | { error: string } => {
    if (!esEntero(crudo, MIN_CUOTAS, MAX_CUOTAS)) return { error: `Las cuotas tienen que ser de ${MIN_CUOTAS} a ${MAX_CUOTAS}.` };
    if (vistas.has(crudo)) return { error: `Hay dos planes de ${crudo} cuotas: dejá uno.` };
    vistas.add(crudo);
    return crudo;
  };
  if (entrada.modo === 'recargo') {
    if (!esEntero(entrada.recargoPorcentaje, 0, RECARGO_MAX_PORCENTAJE)) {
      return { error: `El recargo tiene que ser de 0% a ${RECARGO_MAX_PORCENTAJE}%.` };
    }
    const planes: number[] = [];
    for (const crudo of entrada.planes) {
      const cuotas = cantidadDe(crudo);
      if (typeof cuotas !== 'number') return cuotas;
      planes.push(cuotas);
    }
    return { cuotas: { modo: 'recargo', recargoPorcentaje: entrada.recargoPorcentaje, planes: planes.sort((x, y) => x - y) } };
  }
  const planes: Array<{ cuotas: number; totalCentavos: number }> = [];
  for (const crudo of entrada.planes) {
    if (!esObjeto(crudo)) return { error: 'Las cuotas no son válidas.' };
    const cuotas = cantidadDe(crudo.cuotas);
    if (typeof cuotas !== 'number') return cuotas;
    if (!esEntero(crudo.totalCentavos, 0, PRECIO_MAX_PESOS * 100)) {
      return { error: `Falta el total en ${cuotas} cuotas.` };
    }
    if (crudo.totalCentavos < precioCentavos) {
      return { error: `El total en ${cuotas} cuotas no puede ser menor que el precio (${formatearMonto(precioCentavos, moneda)}).` };
    }
    planes.push({ cuotas, totalCentavos: crudo.totalCentavos });
  }
  return { cuotas: { modo: 'precios', planes: planes.sort((x, y) => x.cuotas - y.cuotas) } };
}

/**
 * Las cuotas guardadas de un producto, sin confiar en la forma: lo que no
 * cierra es "en un pago". Un total que quedó por debajo del precio (porque el
 * precio subió después) se deja de ofrecer: nunca se vende por menos.
 */
export function leerCuotasProducto(guardadas: unknown, precioCentavos: number, moneda: string): CuotasProducto | null {
  let entrada = guardadas;
  if (esObjeto(guardadas) && guardadas.modo === 'precios' && Array.isArray(guardadas.planes)) {
    const vigentes = guardadas.planes.filter(
      (plan) => esObjeto(plan) && typeof plan.totalCentavos === 'number' && plan.totalCentavos >= precioCentavos,
    );
    if (vigentes.length === 0) return null;
    entrada = { ...guardadas, planes: vigentes };
  }
  const resultado = normalizarCuotasProducto(entrada, precioCentavos, monedaDe(moneda));
  return 'cuotas' in resultado ? resultado.cuotas : null;
}

/** Las cantidades de cuotas de un producto. */
export function cantidadesDe(cuotas: CuotasProducto | null): number[] {
  if (!cuotas) return [];
  return cuotas.modo === 'recargo' ? cuotas.planes : cuotas.planes.map((plan) => plan.cuotas);
}

/** Las cuotas que tienen todos los productos de un pedido: ninguna si alguno se vende en un pago. */
export function cuotasEnComun(productos: Array<CuotasProducto | null>): number[] {
  if (productos.length === 0) return [];
  const [primero, ...resto] = productos.map(cantidadesDe);
  return primero.filter((cuotas) => resto.every((otras) => otras.includes(cuotas)));
}

/**
 * Lo que se suma a un renglón por pagarlo en esas cuotas: el recargo sobre su
 * subtotal (ya con las promos) o lo que va del subtotal al total del plan.
 */
export function recargoDeRenglon(
  cuotas: CuotasProducto,
  plan: number,
  renglon: { cantidad: number; subtotalCentavos: number },
): number {
  if (cuotas.modo === 'recargo') return Math.round((renglon.subtotalCentavos * cuotas.recargoPorcentaje) / 100);
  const total = cuotas.planes.find((candidato) => candidato.cuotas === plan)?.totalCentavos ?? 0;
  return Math.max(0, total * renglon.cantidad - renglon.subtotalCentavos);
}

/** Para el asistente: "3, 6 o 12 cuotas sin interés", "3 cuotas: total $ 1.100; 6 cuotas: total $ 1.200". */
export function describirCuotas(cuotas: CuotasProducto, moneda: string = 'ARS'): string {
  if (cuotas.modo === 'precios') {
    return cuotas.planes.map((plan) => `${plan.cuotas} cuotas: total ${formatearMonto(plan.totalCentavos, moneda)}`).join('; ');
  }
  const lista =
    cuotas.planes.length === 1
      ? String(cuotas.planes[0])
      : `${cuotas.planes.slice(0, -1).join(', ')} o ${cuotas.planes[cuotas.planes.length - 1]}`;
  return `${lista} cuotas ${cuotas.recargoPorcentaje === 0 ? 'sin interés' : `con ${cuotas.recargoPorcentaje}% de recargo`}`;
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
 * null si se puede. Sin forma de pago es el contado de siempre. `productos`
 * son las cuotas de cada producto del pedido.
 */
export function problemaDeFormaDePago(
  condiciones: CondicionesPago,
  formaPago: FormaDePago | null,
  cuotas: number | null,
  moneda: Moneda,
  productos: Array<CuotasProducto | null>,
): string | null {
  if (formaPago === 'efectivo' && condiciones.descuentoEfectivoPorcentaje === null) {
    return 'El negocio no tiene descuento por pago en efectivo: creá el pedido sin forma de pago (al precio de siempre).';
  }
  if (formaPago !== 'cuotas') return null;
  if (moneda !== 'ARS') return 'Un pedido en dólares no se paga en cuotas: creá el pedido sin forma de pago.';
  const posibles = cuotasEnComun(productos);
  if (posibles.length === 0) {
    return productos.length > 1 && productos.some((producto) => producto !== null)
      ? 'Estos productos juntos no tienen ninguna cantidad de cuotas en común (o alguno se vende en un pago). ' +
          'Creá el pedido sin forma de pago, o hacé un pedido aparte para el que va en cuotas.'
      : 'Este producto se vende en un pago: creá el pedido sin forma de pago.';
  }
  if (cuotas !== null && posibles.includes(cuotas)) return null;
  return `Con estos productos no hay plan de ${cuotas ?? '?'} cuotas. Los que hay son de ${posibles.join(', ')} cuotas.`;
}
