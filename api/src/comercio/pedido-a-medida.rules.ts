/**
 * Reglas de los pedidos a medida (LAU-24/26/27/28) como funciones puras, igual
 * que ventas.rules.ts. Un pedido a medida es una `Venta` con `tipo:
 * 'a_medida'`: nace cuando el cliente pide algo que se cotiza, no tiene
 * importe ni reserva hasta que hay un presupuesto, y es el mismo pedido de
 * punta a punta (solicitado → a cotizar → cotizado → pendiente de pago →
 * pagado). La atención (asistente o una persona) va aparte del estado.
 */
import { enUnaLinea, esObjeto, LARGO_MAX_RESPUESTA, type RespuestaSolicitud } from './solicitud.rules.js';
import type { EstadoVenta, MedioDePago } from './ventas.rules.js';

export const TIPOS_VENTA = ['stock', 'a_medida'] as const;
export type TipoVenta = (typeof TIPOS_VENTA)[number];

export const ATENCIONES = ['asistente', 'humana'] as const;
export type Atencion = (typeof ATENCIONES)[number];

/**
 * Por qué un pedido pasó a una persona. `sin_reglas` lo pone el código (no
 * hay con qué cotizarlo solo) y `dueno` es el dueño tomándolo desde el panel;
 * el resto los elige el asistente con derivar_a_persona.
 */
export const MOTIVOS_DERIVACION = ['falta_info', 'excepcion', 'pide_persona', 'sin_reglas', 'dueno', 'otro'] as const;
export type MotivoDerivacion = (typeof MOTIVOS_DERIVACION)[number];

export const MOTIVOS_DEL_ASISTENTE = ['falta_info', 'excepcion', 'pide_persona', 'otro'] as const;
export type MotivoDelAsistente = (typeof MOTIVOS_DEL_ASISTENTE)[number];

export const ETIQUETA_MOTIVO: Record<MotivoDerivacion, string> = {
  falta_info: 'falta información que el asistente no puede conseguir',
  excepcion: 'pide algo fuera de lo habitual',
  pide_persona: 'quiere hablar con una persona',
  sin_reglas: 'no hay cómo cotizarlo automáticamente',
  dueno: 'lo tomaste vos',
  otro: 'otro motivo',
};

/** Pedidos a medida abiertos a la vez en una conversación (mismo motivo que MAX_PEDIDOS_PENDIENTES). */
export const MAX_A_MEDIDA_ABIERTOS = 3;

export const LARGO_MAX_RESUMEN = 600;
export const LARGO_MAX_DETALLE_DERIVACION = 300;
export const LARGO_MAX_NOTA = 500;
export const MAX_RESPUESTAS = 15;

/**
 * Lo que vale el cobro de un pedido a medida: sin stock que retener, el link
 * dura más que el de un pedido del catálogo, y uno a coordinar, una semana.
 */
export const HORAS_LINK_A_MEDIDA = 72;
export const DIAS_COBRO_MANUAL_A_MEDIDA = 7;

export function vencimientoDeCobroAMedida(medio: MedioDePago, ahora: Date = new Date()): Date {
  const horas = medio === 'mercadopago' ? HORAS_LINK_A_MEDIDA : DIAS_COBRO_MANUAL_A_MEDIDA * 24;
  return new Date(ahora.getTime() + horas * 60 * 60 * 1000);
}

/** Estados en los que el pedido sigue vivo (todavía se puede cotizar, cobrar o cancelar). */
const ABIERTOS: ReadonlySet<string> = new Set(['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'vencida']);

export function estaAbierto(estado: string): boolean {
  return ABIERTOS.has(estado);
}

/**
 * El asistente se calla en el chat mientras alguno de sus pedidos esté en
 * atención humana y siga abierto: pagarlo o cancelarlo lo devuelve solo.
 */
export function enAtencionHumana(venta: { atencion: string; estado: string }): boolean {
  return venta.atencion === 'humana' && estaAbierto(venta.estado);
}

/**
 * Transiciones permitidas por tipo. Un pedido de stock nace pendiente de pago
 * y no pasa por la cotización. Uno a medida puede recotizarse (`cotizado` →
 * `cotizado`, o volver desde pendiente/vencido a `cotizado`) mientras no se
 * pagó; un pago confirmado no se deshace.
 */
const TRANSICIONES: Record<TipoVenta, Partial<Record<EstadoVenta, readonly EstadoVenta[]>>> = {
  stock: {
    pendiente_pago: ['pagada', 'cancelada', 'vencida'],
    vencida: ['pagada', 'cancelada'],
  },
  a_medida: {
    solicitado: ['a_cotizar', 'cotizado', 'cancelada'],
    a_cotizar: ['a_cotizar', 'cotizado', 'cancelada'],
    cotizado: ['cotizado', 'pendiente_pago', 'cancelada'],
    pendiente_pago: ['cotizado', 'pendiente_pago', 'pagada', 'cancelada', 'vencida'],
    vencida: ['cotizado', 'pendiente_pago', 'pagada', 'cancelada'],
  },
};

export function leerTipoVenta(tipo: string): TipoVenta {
  return tipo === 'a_medida' ? 'a_medida' : 'stock';
}

export function transicionPermitida(tipo: string, de: EstadoVenta, a: EstadoVenta): boolean {
  return TRANSICIONES[leerTipoVenta(tipo)][de]?.includes(a) ?? false;
}

/** La foto de lo que pidió el cliente, guardada en `Venta.solicitud`. */
export type SolicitudDeVenta = {
  productoId: string | null;
  nombreProducto: string | null;
  respuestas: RespuestaSolicitud[];
  resumen: string;
};

/** Lee `Venta.solicitud` sin confiar en la forma: lo que no cierra queda afuera. */
export function leerSolicitudDeVenta(valor: unknown): SolicitudDeVenta | null {
  if (!esObjeto(valor)) return null;
  const respuestas = (Array.isArray(valor.respuestas) ? valor.respuestas : [])
    .filter(
      (dato): dato is RespuestaSolicitud =>
        esObjeto(dato) && typeof dato.pregunta === 'string' && typeof dato.respuesta === 'string',
    )
    .slice(0, MAX_RESPUESTAS)
    .map((dato) => ({ pregunta: dato.pregunta, respuesta: dato.respuesta }));
  return {
    productoId: typeof valor.productoId === 'string' ? valor.productoId : null,
    nombreProducto: typeof valor.nombreProducto === 'string' ? valor.nombreProducto : null,
    respuestas,
    resumen: typeof valor.resumen === 'string' ? valor.resumen : '',
  };
}

/** Arma la foto para guardar: una línea por campo y con los topes de largo. */
export function armarSolicitudDeVenta(datos: {
  productoId: string | null;
  nombreProducto: string | null;
  respuestas: RespuestaSolicitud[];
  resumen: string;
}): SolicitudDeVenta {
  return {
    productoId: datos.productoId,
    nombreProducto: datos.nombreProducto,
    respuestas: datos.respuestas.slice(0, MAX_RESPUESTAS).map((dato) => ({
      pregunta: enUnaLinea(dato.pregunta).slice(0, 120),
      respuesta: enUnaLinea(dato.respuesta).slice(0, LARGO_MAX_RESPUESTA),
    })),
    resumen: enUnaLinea(datos.resumen).slice(0, LARGO_MAX_RESUMEN),
  };
}

/** "ancho: 120; color: Blanco", para el presupuesto y los avisos. */
export function resumenDeRespuestas(respuestas: RespuestaSolicitud[]): string {
  return respuestas.map((dato) => `${dato.pregunta}: ${dato.respuesta}`).join('; ');
}

/**
 * ¿Cambió lo que pidió el cliente? Un cambio de respuestas es material: el
 * presupuesto anterior ya no vale y hay que recotizar antes de cobrar.
 */
export function cambioMaterial(antes: RespuestaSolicitud[], despues: RespuestaSolicitud[]): boolean {
  const clave = (lista: RespuestaSolicitud[]) =>
    JSON.stringify(
      [...lista]
        .map((dato) => [dato.pregunta.trim().toLowerCase(), dato.respuesta.trim().toLowerCase()])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return clave(antes) !== clave(despues);
}

/** Lo que contesta el banco de pruebas del Home cuando el chat lo atiende el dueño. */
export const MENSAJE_ATENCION_HUMANA_PRUEBA =
  'Este chat está en atención humana: el asistente no contesta hasta que lo devuelvas desde Ventas.';
