/**
 * Reglas del histórico de ventas como funciones puras: el rango de días (en la
 * zona del negocio) y el armado del CSV. Nada de acá toca la base.
 */
import { claveDia, fechaEnDia } from '../conversation/graph/agenda-rules.js';
import { formatearCentavos } from './catalogo.rules.js';
import { estadoVisible, fechaYHora, type EstadoVenta } from './ventas.rules.js';

/** Días que muestra el histórico si no se pide otro rango. */
export const DIAS_POR_DEFECTO = 30;

/** Rango más largo que se puede pedir de una vez (un año y un día bisiesto). */
export const MAX_DIAS_RANGO = 366;

/** Filas máximas de un export: más que eso se pide por partes. */
export const MAX_FILAS_CSV = 10_000;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type Rango = {
  /** "YYYY-MM-DD" del primer y el último día, inclusive. */
  primerDia: string;
  ultimoDia: string;
  /** Límites como instantes: [desde, hasta). */
  desde: Date;
  hasta: Date;
};

export class RangoInvalidoError extends Error {}

function diaSiguiente(dia: string): string {
  return claveDia(new Date(fechaEnDia(dia, '12:00').getTime() + MS_POR_DIA));
}

/**
 * Días del negocio → instantes. Sin `desde`/`hasta`, los últimos 30 días
 * contando hoy. Los días son de la zona del negocio: "hoy" empieza a las
 * 00:00 de Buenos Aires aunque la API corra en UTC.
 */
export function rangoDeDias(desde: string | undefined, hasta: string | undefined, ahora: Date = new Date()): Rango {
  const ultimoDia = hasta ?? claveDia(ahora);
  const primerDia = desde ?? claveDia(new Date(fechaEnDia(ultimoDia, '12:00').getTime() - (DIAS_POR_DEFECTO - 1) * MS_POR_DIA));
  for (const dia of [primerDia, ultimoDia]) {
    if (!DIA.test(dia) || Number.isNaN(fechaEnDia(dia, '00:00').getTime()) || claveDia(fechaEnDia(dia, '12:00')) !== dia) {
      throw new RangoInvalidoError(`"${dia}" no es un día válido (tiene que ser AAAA-MM-DD).`);
    }
  }
  if (primerDia > ultimoDia) throw new RangoInvalidoError('El día de inicio es posterior al de fin.');
  const dias = diasEntre(primerDia, ultimoDia).length;
  if (dias > MAX_DIAS_RANGO) throw new RangoInvalidoError(`El rango puede tener hasta ${MAX_DIAS_RANGO} días.`);
  return {
    primerDia,
    ultimoDia,
    desde: fechaEnDia(primerDia, '00:00'),
    hasta: fechaEnDia(diaSiguiente(ultimoDia), '00:00'),
  };
}

/** Todos los días del rango, inclusive, para completar con cero los que no tuvieron ventas. */
export function diasEntre(primerDia: string, ultimoDia: string): string[] {
  const dias: string[] = [];
  for (let dia = primerDia; dia <= ultimoDia && dias.length <= MAX_DIAS_RANGO; dia = diaSiguiente(dia)) {
    dias.push(dia);
  }
  return dias;
}

/**
 * Una celda de CSV para Excel en español (separador ";"). Lo que empieza con
 * =, +, - o @ se lleva un apóstrofo adelante: el nombre del cliente lo
 * escribe cualquiera por WhatsApp, y una planilla no tiene que ejecutarlo
 * como fórmula (CSV injection).
 */
export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export const ENCABEZADOS_CSV = [
  'fecha',
  'estado',
  'cliente',
  'telefono',
  'medio_de_pago',
  'productos',
  'total',
  'pagada_el',
  'operacion_mercado_pago',
  'prueba',
] as const;

const ETIQUETA_ESTADO: Record<EstadoVenta, string> = {
  pendiente_pago: 'pendiente de pago',
  pagada: 'pagada',
  cancelada: 'cancelada',
  vencida: 'vencida',
};

export type VentaParaCsv = {
  createdAt: Date;
  estado: string;
  reservaVenceAt: Date;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  medioPago: string;
  totalCentavos: number;
  pagadaAt: Date | null;
  mpPaymentId: string | null;
  dePrueba: boolean;
  items: Array<{ cantidad: number; nombreProducto: string; nombreVariante: string }>;
};

/** El CSV entero, con BOM para que Excel lea bien las tildes. */
export function ventasACsv(ventas: VentaParaCsv[], ahora: Date = new Date()): string {
  const filas = ventas.map((venta) =>
    [
      fechaYHora(venta.createdAt),
      ETIQUETA_ESTADO[estadoVisible(venta, ahora)],
      venta.nombreCliente,
      venta.telefonoCliente ? `+${venta.telefonoCliente}` : '',
      venta.medioPago === 'mercadopago' ? 'Mercado Pago' : 'a coordinar',
      venta.items
        .map((item) => `${item.cantidad} × ${item.nombreProducto}${item.nombreVariante ? ` (${item.nombreVariante})` : ''}`)
        .join(', '),
      formatearCentavos(venta.totalCentavos),
      venta.pagadaAt ? fechaYHora(venta.pagadaAt) : '',
      venta.mpPaymentId,
      venta.dePrueba ? 'sí' : '',
    ]
      .map(celdaCsv)
      .join(';'),
  );
  return `\uFEFF${[ENCABEZADOS_CSV.join(';'), ...filas].join('\r\n')}\r\n`;
}
