/**
 * Reglas de los descuentos del asistente de ventas, puras como
 * catalogo.rules.ts: cuándo un descuento está vigente, a qué producto le
 * toca, cuánto descuenta y cuál gana cuando hay más de uno.
 *
 * - Un descuento es de un producto (el de su formulario), de una categoría o
 *   de todo el catálogo; el alcance sale de `productoId` y `categoria`.
 * - Es un porcentaje (1 a PORCENTAJE_MAX) o un monto fijo en centavos.
 * - Si a una variante le tocan varios, se aplica el que más le descuenta al
 *   cliente. Nunca se suman: no hay ninguna regla que diga que se acumulan.
 * - Un descuento que dejaría el precio en $ 0 (o menos) no aplica: Mercado
 *   Pago no cobra un ítem de precio cero, y regalar algo no es un descuento.
 */
import { claveDia, fechaEnDia } from '../conversation/graph/agenda-rules.js';
import { formatearCentavos, normalizarTexto } from './catalogo.rules.js';

export const TIPOS_DESCUENTO = ['porcentaje', 'monto'] as const;
export type TipoDescuento = (typeof TIPOS_DESCUENTO)[number];

/** Más que esto ya no es un descuento sino casi regalarlo: lo frena la validación. */
export const PORCENTAJE_MAX = 90;

/** Promos de catálogo o de categoría por cuenta (los de producto no cuentan). */
export const MAX_PROMOCIONES = 20;

export type AlcanceDescuento = 'producto' | 'categoria' | 'catalogo';

export type DescuentoParaAplicar = {
  id: string;
  productoId: string | null;
  categoria: string | null;
  nombre: string;
  tipo: string;
  valor: number;
  activo: boolean;
  desde: Date | null;
  hasta: Date | null;
};

export type DescuentoAplicado = {
  descuentoId: string;
  alcance: AlcanceDescuento;
  precioListaCentavos: number;
  /** Por unidad. */
  descuentoCentavos: number;
  precioFinalCentavos: number;
  /** "20% off", "$ 500 off": lo que se le dice al cliente. */
  etiqueta: string;
  /** "Semana del mate", o "" (los de producto no tienen nombre). */
  nombre: string;
  /** Último día de vigencia ("YYYY-MM-DD"), o null si no vence. */
  hastaDia: string | null;
};

/** Más específico gana un empate: el dueño lo eligió para ese producto. */
const PRIORIDAD: Record<AlcanceDescuento, number> = { producto: 0, categoria: 1, catalogo: 2 };

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export function alcanceDe(descuento: Pick<DescuentoParaAplicar, 'productoId' | 'categoria'>): AlcanceDescuento {
  if (descuento.productoId) return 'producto';
  if (descuento.categoria) return 'categoria';
  return 'catalogo';
}

/** Activo y dentro de [desde, hasta). */
export function descuentoVigente(
  descuento: Pick<DescuentoParaAplicar, 'activo' | 'desde' | 'hasta'>,
  ahora: Date = new Date(),
): boolean {
  if (!descuento.activo) return false;
  if (descuento.desde && ahora < descuento.desde) return false;
  if (descuento.hasta && ahora >= descuento.hasta) return false;
  return true;
}

/** Si el descuento es para este producto, sin mirar la vigencia. */
export function aplicaA(
  descuento: Pick<DescuentoParaAplicar, 'productoId' | 'categoria'>,
  producto: { id: string; categoria: string | null },
): boolean {
  switch (alcanceDe(descuento)) {
    case 'producto':
      return descuento.productoId === producto.id;
    case 'categoria':
      return (
        producto.categoria !== null &&
        normalizarTexto(producto.categoria) === normalizarTexto(descuento.categoria as string)
      );
    case 'catalogo':
      return true;
  }
}

/** Centavos que descuenta por unidad, o 0 si no aplica a ese precio. */
export function montoDeDescuento(descuento: Pick<DescuentoParaAplicar, 'tipo' | 'valor'>, precioCentavos: number): number {
  if (precioCentavos <= 0 || descuento.valor <= 0) return 0;
  let monto = 0;
  if (descuento.tipo === 'porcentaje') {
    monto = Math.round((precioCentavos * Math.min(descuento.valor, PORCENTAJE_MAX)) / 100);
  } else if (descuento.tipo === 'monto') {
    monto = descuento.valor;
  }
  return monto > 0 && monto < precioCentavos ? monto : 0;
}

/** "20% off" o "$ 500 off". */
export function etiquetaDescuento(descuento: Pick<DescuentoParaAplicar, 'tipo' | 'valor'>): string {
  return descuento.tipo === 'porcentaje' ? `${descuento.valor}% off` : `${formatearCentavos(descuento.valor)} off`;
}

/**
 * El descuento que se aplica a una variante: de los vigentes que le tocan, el
 * que más descuenta; a igual monto, el más específico (producto, categoría,
 * catálogo) y después el id, para que siempre gane el mismo. Null si ninguno.
 */
export function mejorDescuento(
  descuentos: DescuentoParaAplicar[],
  producto: { id: string; categoria: string | null },
  precioCentavos: number,
  ahora: Date = new Date(),
): DescuentoAplicado | null {
  let mejor: { descuento: DescuentoParaAplicar; monto: number } | null = null;
  for (const descuento of descuentos) {
    if (!descuentoVigente(descuento, ahora) || !aplicaA(descuento, producto)) continue;
    const monto = montoDeDescuento(descuento, precioCentavos);
    if (monto === 0) continue;
    if (
      !mejor ||
      monto > mejor.monto ||
      (monto === mejor.monto &&
        (PRIORIDAD[alcanceDe(descuento)] < PRIORIDAD[alcanceDe(mejor.descuento)] ||
          (PRIORIDAD[alcanceDe(descuento)] === PRIORIDAD[alcanceDe(mejor.descuento)] &&
            descuento.id < mejor.descuento.id)))
    ) {
      mejor = { descuento, monto };
    }
  }
  if (!mejor) return null;
  return {
    descuentoId: mejor.descuento.id,
    alcance: alcanceDe(mejor.descuento),
    precioListaCentavos: precioCentavos,
    descuentoCentavos: mejor.monto,
    precioFinalCentavos: precioCentavos - mejor.monto,
    etiqueta: etiquetaDescuento(mejor.descuento),
    nombre: mejor.descuento.nombre,
    hastaDia: diaDeHasta(mejor.descuento.hasta),
  };
}

/** "YYYY-MM-DD" del primer día de vigencia → el instante en que empieza (00:00 del negocio). */
export function inicioDeVigencia(dia: string): Date {
  return fechaEnDia(dia, '00:00');
}

/** "YYYY-MM-DD" del último día de vigencia (inclusive) → el instante en que termina: las 00:00 del día siguiente. */
export function finDeVigencia(dia: string): Date {
  return new Date(fechaEnDia(dia, '00:00').getTime() + MS_POR_DIA);
}

/** true si "AAAA-MM-DD" es un día que existe: "2026-02-31" o "2026-13-45" no (new Date los corre o da NaN). */
export function diaValido(dia: string): boolean {
  const fecha = inicioDeVigencia(dia);
  return !Number.isNaN(fecha.getTime()) && claveDia(fecha) === dia;
}

/** Inverso de inicioDeVigencia. */
export function diaDeDesde(desde: Date | null): string | null {
  return desde ? claveDia(desde) : null;
}

/** Inverso de finDeVigencia: el último día en que vale. */
export function diaDeHasta(hasta: Date | null): string | null {
  return hasta ? claveDia(new Date(hasta.getTime() - 1)) : null;
}

/** "31/10" de un "YYYY-MM-DD". */
export function diaCorto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Lo que vuelve al modelo junto al precio: "20% off hasta el 31/10, promo \"Semana del mate\"". */
export function detalleParaElModelo(aplicado: DescuentoAplicado): string {
  return (
    aplicado.etiqueta +
    (aplicado.hastaDia ? ` hasta el ${diaCorto(aplicado.hastaDia)}` : '') +
    (aplicado.nombre ? `, promo ${JSON.stringify(aplicado.nombre)}` : '')
  );
}

/**
 * Por qué no se puede guardar un descuento, o null si está bien. Se usa en el
 * service además de class-validator, porque el tope depende del tipo y
 * `hasta` no puede ser anterior a `desde`.
 */
export function problemaDeDescuento(datos: {
  tipo: string;
  valor: number;
  desde?: string | null;
  hasta?: string | null;
}): string | null {
  if (!(TIPOS_DESCUENTO as readonly string[]).includes(datos.tipo)) return 'El tipo de descuento es porcentaje o monto.';
  if (!Number.isInteger(datos.valor) || datos.valor <= 0) return 'El descuento tiene que ser mayor que cero.';
  if (datos.tipo === 'porcentaje' && datos.valor > PORCENTAJE_MAX) {
    return `El porcentaje de descuento va de 1 a ${PORCENTAJE_MAX}.`;
  }
  for (const dia of [datos.desde, datos.hasta]) {
    if (dia && !diaValido(dia)) return `La fecha ${dia} no existe.`;
  }
  if (datos.desde && datos.hasta && datos.hasta < datos.desde) return 'La fecha "hasta" no puede ser anterior a "desde".';
  return null;
}
