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

/**
 * La versión de precio fijo de la que sale el pedido: la que eligió tal cual
 * (pedir_variante) o la que usó de base para pedir cambios. Foto del nombre y
 * del precio al pedir, como `ItemVenta`.
 */
export type VarianteDeSolicitud = { id: string; nombre: string; precioCentavos: number; cantidad: number };

/** La foto de lo que pidió el cliente, guardada en `Venta.solicitud`. */
export type SolicitudDeVenta = {
  productoId: string | null;
  nombreProducto: string | null;
  respuestas: RespuestaSolicitud[];
  resumen: string;
  /** null si no salió de una versión de precio fijo. */
  variante: VarianteDeSolicitud | null;
  /** Lo que el cliente quiere distinto de esa versión (null = la quiere tal cual, o no hay versión). */
  cambios: string | null;
};

function leerVarianteDeSolicitud(valor: unknown): VarianteDeSolicitud | null {
  if (!esObjeto(valor) || typeof valor.id !== 'string' || typeof valor.nombre !== 'string') return null;
  const { precioCentavos, cantidad } = valor;
  if (typeof precioCentavos !== 'number' || !Number.isInteger(precioCentavos) || precioCentavos < 0) return null;
  if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 1) return null;
  return { id: valor.id, nombre: valor.nombre, precioCentavos, cantidad };
}

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
  const variante = leerVarianteDeSolicitud(valor.variante);
  return {
    productoId: typeof valor.productoId === 'string' ? valor.productoId : null,
    nombreProducto: typeof valor.nombreProducto === 'string' ? valor.nombreProducto : null,
    respuestas,
    resumen: typeof valor.resumen === 'string' ? valor.resumen : '',
    variante,
    cambios: variante && typeof valor.cambios === 'string' && valor.cambios.trim() ? valor.cambios : null,
  };
}

/** Arma la foto para guardar: una línea por campo y con los topes de largo. */
export function armarSolicitudDeVenta(datos: {
  productoId: string | null;
  nombreProducto: string | null;
  respuestas: RespuestaSolicitud[];
  resumen: string;
  variante?: VarianteDeSolicitud | null;
  cambios?: string | null;
}): SolicitudDeVenta {
  const variante = datos.variante
    ? { ...datos.variante, nombre: enUnaLinea(datos.variante.nombre).slice(0, 120) }
    : null;
  const cambios = variante && datos.cambios ? enUnaLinea(datos.cambios).slice(0, LARGO_MAX_RESPUESTA) || null : null;
  return {
    productoId: datos.productoId,
    nombreProducto: datos.nombreProducto,
    respuestas: datos.respuestas.slice(0, MAX_RESPUESTAS).map((dato) => ({
      pregunta: enUnaLinea(dato.pregunta).slice(0, 120),
      respuesta: enUnaLinea(dato.respuesta).slice(0, LARGO_MAX_RESPUESTA),
    })),
    resumen: enUnaLinea(datos.resumen).slice(0, LARGO_MAX_RESUMEN),
    variante,
    cambios,
  };
}

/** "ancho: 120; color: Blanco", para el presupuesto y los avisos. */
export function resumenDeRespuestas(respuestas: RespuestaSolicitud[]): string {
  return respuestas.map((dato) => `${dato.pregunta}: ${dato.respuesta}`).join('; ');
}

/**
 * La versión de base y lo que cambia, en una línea para el dueño: "Base: Roble
 * 1,20 m · Cambios: 1,50 m de largo". Vacío si no salió de una versión.
 */
export function resumenDeVariante(solicitud: Pick<SolicitudDeVenta, 'variante' | 'cambios'> | null): string {
  if (!solicitud?.variante) return '';
  const { nombre, cantidad } = solicitud.variante;
  const cual = `${cantidad > 1 ? `${cantidad} × ` : ''}${nombre}`;
  return solicitud.cambios ? `Base: ${cual} · Cambios: ${solicitud.cambios}` : `Versión: ${cual} (tal cual, precio fijo)`;
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

/** Como `cambioMaterial`, pero también cuenta otra versión de base u otros cambios pedidos. */
export function cambioDeSolicitud(
  antes: Pick<SolicitudDeVenta, 'respuestas' | 'variante' | 'cambios'>,
  despues: Pick<SolicitudDeVenta, 'respuestas' | 'variante' | 'cambios'>,
): boolean {
  const normal = (texto: string | null) => enUnaLinea(texto ?? '').toLowerCase();
  return (
    cambioMaterial(antes.respuestas, despues.respuestas) ||
    (antes.variante?.id ?? null) !== (despues.variante?.id ?? null) ||
    (antes.variante?.cantidad ?? null) !== (despues.variante?.cantidad ?? null) ||
    normal(antes.cambios) !== normal(despues.cambios)
  );
}

/**
 * El renglón del presupuesto de una versión pedida tal cual: su precio por la
 * cantidad, calculado acá y nunca por el modelo.
 */
export function renglonDeVariante(variante: VarianteDeSolicitud): {
  concepto: string;
  tipo: 'otro';
  cantidad: number;
  unidad: string;
  precioUnitarioCentavos: number;
  subtotalCentavos: number;
} {
  return {
    concepto: enUnaLinea(variante.nombre).slice(0, 120),
    tipo: 'otro',
    cantidad: variante.cantidad,
    unidad: 'u',
    precioUnitarioCentavos: variante.precioCentavos,
    subtotalCentavos: variante.precioCentavos * variante.cantidad,
  };
}

/**
 * Lo que queda en `ItemVenta` al cobrar un pedido a medida. Una versión
 * pedida tal cual, cobrada a su precio, figura como esa variante (con su id,
 * su nombre y la cantidad), así el histórico dice qué se vendió; cualquier
 * otro caso es un renglón con el presupuesto.
 */
export function itemDeCobro(
  solicitud: SolicitudDeVenta | null,
  presupuesto: { version: number; totalCentavos: number },
): { varianteId: string | null; nombreVariante: string; precioUnitarioCentavos: number; cantidad: number } {
  const variante = solicitud?.variante;
  if (variante && !solicitud.cambios && variante.precioCentavos * variante.cantidad === presupuesto.totalCentavos) {
    return {
      varianteId: variante.id,
      nombreVariante: variante.nombre,
      precioUnitarioCentavos: variante.precioCentavos,
      cantidad: variante.cantidad,
    };
  }
  return {
    varianteId: null,
    nombreVariante: `Presupuesto v${presupuesto.version}`,
    precioUnitarioCentavos: presupuesto.totalCentavos,
    cantidad: 1,
  };
}

/** Lo que contesta el banco de pruebas del Home cuando el chat lo atiende el dueño. */
export const MENSAJE_ATENCION_HUMANA_PRUEBA =
  'Este chat está en atención humana: el asistente no contesta hasta que lo devuelvas desde Ventas.';
