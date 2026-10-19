/**
 * Reglas de los presupuestos de un pedido a medida (LAU-26) como funciones
 * puras. Un presupuesto es una lista de renglones con su precio y un total que
 * se calcula acá, nunca en el modelo. Los arma el dueño desde el panel o la
 * receta del producto (Fase 2, cotizacion.rules.ts); los dos terminan en la
 * misma forma y en el mismo texto para el cliente.
 */
import { formatearCentavos, PRECIO_MAX_PESOS } from './catalogo.rules.js';
import { resumenDeRespuestas, type SolicitudDeVenta } from './pedido-a-medida.rules.js';
import { enUnaLinea, esObjeto } from './solicitud.rules.js';

export const TIPOS_RENGLON = ['material', 'proceso', 'mano_obra', 'extra', 'otro'] as const;
export type TipoRenglon = (typeof TIPOS_RENGLON)[number];

export const ESTADOS_PRESUPUESTO = ['borrador', 'enviado', 'reemplazado', 'descartado'] as const;
export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[number];

export const ORIGENES_PRESUPUESTO = ['asistente', 'dueno'] as const;
export type OrigenPresupuesto = (typeof ORIGENES_PRESUPUESTO)[number];

export const MAX_RENGLONES_PRESUPUESTO = 30;
export const LARGO_MAX_CONCEPTO = 120;
export const LARGO_MAX_UNIDAD = 20;
export const CANTIDAD_MAX = 1_000_000;
export const LARGO_MAX_NOTA_PRESUPUESTO = 500;
/** El total más alto que se acepta (el mismo tope que un precio del catálogo). */
export const TOTAL_MAX_CENTAVOS = PRECIO_MAX_PESOS * 100;

export type RenglonPresupuesto = {
  concepto: string;
  tipo: TipoRenglon;
  /** Puede tener decimales (2,4 m²); hasta 3. */
  cantidad: number;
  /** "m²", "h", "u"… Vacío si no aplica. */
  unidad: string;
  precioUnitarioCentavos: number;
  subtotalCentavos: number;
};

export type RenglonEntrada = {
  concepto?: unknown;
  tipo?: unknown;
  cantidad?: unknown;
  unidad?: unknown;
  precioUnitarioCentavos?: unknown;
};

export type PresupuestoArmado = { renglones: RenglonPresupuesto[]; totalCentavos: number };

/** Redondea la cantidad a 3 decimales, que es lo que se muestra y se guarda. */
export function redondearCantidad(cantidad: number): number {
  return Math.round(cantidad * 1000) / 1000;
}

/** Subtotal de un renglón en centavos enteros. */
export function subtotalDe(cantidad: number, precioUnitarioCentavos: number): number {
  return Math.round(redondearCantidad(cantidad) * precioUnitarioCentavos);
}

function esTipoRenglon(valor: unknown): valor is TipoRenglon {
  return typeof valor === 'string' && (TIPOS_RENGLON as readonly string[]).includes(valor);
}

/**
 * Valida y normaliza los renglones que llegan del panel. Devuelve el error
 * con el número de renglón para que el dueño sepa cuál corregir. El total es
 * la suma de los subtotales y tiene que ser mayor que cero.
 */
export function normalizarRenglones(entrada: unknown): PresupuestoArmado | { error: string } {
  if (!Array.isArray(entrada) || entrada.length === 0) return { error: 'El presupuesto necesita al menos un renglón.' };
  if (entrada.length > MAX_RENGLONES_PRESUPUESTO) {
    return { error: `Un presupuesto puede tener hasta ${MAX_RENGLONES_PRESUPUESTO} renglones.` };
  }
  const renglones: RenglonPresupuesto[] = [];
  for (const [indice, crudo] of entrada.entries()) {
    const numero = indice + 1;
    if (!esObjeto(crudo)) return { error: `El renglón ${numero} no es válido.` };
    const renglon = crudo as RenglonEntrada;
    const concepto = typeof renglon.concepto === 'string' ? enUnaLinea(renglon.concepto) : '';
    if (!concepto) return { error: `Al renglón ${numero} le falta qué es.` };
    if (concepto.length > LARGO_MAX_CONCEPTO) {
      return { error: `El renglón ${numero} tiene más de ${LARGO_MAX_CONCEPTO} caracteres.` };
    }
    const cantidad = typeof renglon.cantidad === 'number' ? renglon.cantidad : Number.NaN;
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > CANTIDAD_MAX) {
      return { error: `La cantidad del renglón ${numero} tiene que ser un número mayor que cero.` };
    }
    const unitario = renglon.precioUnitarioCentavos;
    if (typeof unitario !== 'number' || !Number.isInteger(unitario) || unitario < 0 || unitario > TOTAL_MAX_CENTAVOS) {
      return { error: `El precio del renglón ${numero} no es válido.` };
    }
    const unidad = typeof renglon.unidad === 'string' ? enUnaLinea(renglon.unidad).slice(0, LARGO_MAX_UNIDAD) : '';
    renglones.push({
      concepto,
      tipo: esTipoRenglon(renglon.tipo) ? renglon.tipo : 'otro',
      cantidad: redondearCantidad(cantidad),
      unidad,
      precioUnitarioCentavos: unitario,
      subtotalCentavos: subtotalDe(cantidad, unitario),
    });
  }
  const totalCentavos = renglones.reduce((suma, renglon) => suma + renglon.subtotalCentavos, 0);
  if (totalCentavos <= 0) return { error: 'El total del presupuesto tiene que ser mayor que cero.' };
  if (totalCentavos > TOTAL_MAX_CENTAVOS) return { error: 'El total del presupuesto es demasiado alto.' };
  return { renglones, totalCentavos };
}

/** Lee `Presupuesto.renglones` sin confiar en la forma (lo que no cierra se descarta). */
export function leerRenglones(valor: unknown): RenglonPresupuesto[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((crudo): RenglonPresupuesto[] => {
    if (!esObjeto(crudo)) return [];
    const { concepto, cantidad, unidad, precioUnitarioCentavos, subtotalCentavos, tipo } = crudo;
    if (
      typeof concepto !== 'string' ||
      typeof cantidad !== 'number' ||
      typeof precioUnitarioCentavos !== 'number' ||
      typeof subtotalCentavos !== 'number'
    ) {
      return [];
    }
    return [
      {
        concepto,
        tipo: esTipoRenglon(tipo) ? tipo : 'otro',
        cantidad,
        unidad: typeof unidad === 'string' ? unidad : '',
        precioUnitarioCentavos,
        subtotalCentavos,
      },
    ];
  });
}

const FORMATO_CANTIDAD = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

/** "2,4 m² × $ 10.000 = $ 24.000"; sin la cuenta si la cantidad es 1 y no hay unidad. */
export function lineaDeRenglon(renglon: RenglonPresupuesto): string {
  if (renglon.cantidad === 1 && !renglon.unidad) return `${renglon.concepto}: ${formatearCentavos(renglon.subtotalCentavos)}`;
  const cantidad = `${FORMATO_CANTIDAD.format(renglon.cantidad)}${renglon.unidad ? ` ${renglon.unidad}` : ''}`;
  return (
    `${renglon.concepto}: ${cantidad} × ${formatearCentavos(renglon.precioUnitarioCentavos)} = ` +
    formatearCentavos(renglon.subtotalCentavos)
  );
}

export type PresupuestoParaTexto = {
  renglones: RenglonPresupuesto[];
  totalCentavos: number;
  estimativo: boolean;
  detalleAlCliente: boolean;
  nota: string | null;
  /** Fase 2: sólo si el dueño la configuró. Null = no se dice nada de la vigencia. */
  vigenciaDias?: number | null;
};

/**
 * El presupuesto como lo lee el cliente por WhatsApp, en el formato de
 * WhatsApp (negrita con un asterisco). Lo arma el código: cuando lo manda el
 * panel no pasa por el modelo, y cuando lo pasa el asistente va tal cual.
 * Nunca agrega plazos ni condiciones que el dueño no escribió.
 */
export function textoDelPresupuesto(
  presupuesto: PresupuestoParaTexto,
  solicitud: SolicitudDeVenta | null,
  cierre: string,
): string {
  const producto = solicitud?.nombreProducto ? ` de ${solicitud.nombreProducto}` : '';
  const lineas = [`*Presupuesto${producto}*`];
  if (solicitud?.variante && solicitud.cambios) {
    lineas.push(`Sobre ${solicitud.variante.nombre}, con estos cambios: ${solicitud.cambios}.`);
  }
  if (solicitud && solicitud.respuestas.length > 0) lineas.push(`Lo que nos pediste: ${resumenDeRespuestas(solicitud.respuestas)}.`);
  if (presupuesto.detalleAlCliente) for (const renglon of presupuesto.renglones) lineas.push(`* ${lineaDeRenglon(renglon)}`);
  lineas.push(
    `*Total: ${formatearCentavos(presupuesto.totalCentavos)}*` +
      (presupuesto.estimativo ? ' (es estimativo: el precio final puede variar un poco)' : ''),
  );
  if (presupuesto.vigenciaDias) lineas.push(`Vale por ${presupuesto.vigenciaDias} días.`);
  if (presupuesto.nota) lineas.push(presupuesto.nota);
  return `${lineas.join('\n')}\n\n${cierre}`;
}

/** Cómo termina el mensaje del presupuesto según cómo cobra el comercio. */
export function cierreDelPresupuesto(conMercadoPago: boolean): string {
  return conMercadoPago
    ? '¿Querés que avancemos? Si me decís que sí, te paso el link de pago.'
    : '¿Querés que avancemos? Si me decís que sí, lo anotamos y coordinamos el pago por acá.';
}
