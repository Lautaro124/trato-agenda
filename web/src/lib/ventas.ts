import { apiFetch } from "./api";
import { ErrorDeApi } from "./productos";

/** Los tres primeros sólo existen en los pedidos a medida: todavía no tienen precio. */
export type EstadoVenta =
  | "solicitado"
  | "a_cotizar"
  | "cotizado"
  | "pendiente_pago"
  | "pagada"
  | "cancelada"
  | "vencida";

export type RespuestaSolicitud = { pregunta: string; respuesta: string };

/** Lo que pidió el cliente en un pedido a medida (espejo de `SolicitudDeVenta`). */
export type SolicitudDePedido = {
  productoId: string | null;
  nombreProducto: string | null;
  respuestas: RespuestaSolicitud[];
  resumen: string;
};

/** Espejo de `VentaPublica` en la API. */
export type Venta = {
  id: string;
  estado: EstadoVenta;
  /** "stock" (del catálogo) | "a_medida" (se cotiza). */
  tipo: "stock" | "a_medida";
  /** "humana" mientras lo atendés vos: el asistente no contesta en ese chat. */
  atencion: "asistente" | "humana";
  derivadaAt: string | null;
  motivoDerivacion: string | null;
  detalleDerivacion: string | null;
  devueltaAt: string | null;
  solicitud: SolicitudDePedido | null;
  /** null en un pedido a medida que todavía no se cobra. */
  medioPago: "mercadopago" | "manual" | null;
  nombreCliente: string | null;
  telefonoCliente: string | null;
  /** null mientras un pedido a medida no tiene presupuesto. */
  totalCentavos: number | null;
  moneda: string;
  reservaVenceAt: string | null;
  linkPago: string | null;
  pagadaAt: string | null;
  canceladaAt: string | null;
  sinStockAlPagar: boolean;
  /** Pedido del chat de prueba del Home: no cuenta en los totales salvo que se pida. */
  dePrueba: boolean;
  createdAt: string;
  mpPaymentId: string | null;
  /** null si el comercio no hace envíos. */
  entrega: "envio" | "retiro" | null;
  /** Lo que el cliente contestó (envío, DNI, datos propios del comercio). */
  datosCliente: Array<{ etiqueta: string; valor: string }>;
  items: Array<{
    codigo: string;
    nombreProducto: string;
    nombreVariante: string;
    cantidad: number;
    /** Lo que se cobró por unidad, ya con el descuento. */
    precioUnitarioCentavos: number;
    subtotalCentavos: number;
    /** Precio de lista por unidad; null en ventas anteriores a los descuentos. */
    precioListaCentavos: number | null;
    descuentoCentavos: number;
    descuentoEtiqueta: string | null;
  }>;
};

export const TIPOS_RENGLON = ["material", "proceso", "mano_obra", "extra", "otro"] as const;
export type TipoRenglon = (typeof TIPOS_RENGLON)[number];

export type RenglonPresupuesto = {
  concepto: string;
  tipo: TipoRenglon;
  cantidad: number;
  unidad: string;
  precioUnitarioCentavos: number;
  subtotalCentavos: number;
};

export type Presupuesto = {
  id: string;
  version: number;
  origen: "asistente" | "dueno";
  estado: "borrador" | "enviado" | "reemplazado" | "descartado";
  totalCentavos: number;
  moneda: string;
  estimativo: boolean;
  detalleAlCliente: boolean;
  nota: string | null;
  enviadoAt: string | null;
  createdAt: string;
  renglones: RenglonPresupuesto[];
};

export type EventoPedido = {
  tipo: "estado" | "derivacion" | "devolucion" | "presupuesto" | "cobro";
  de: string | null;
  a: string | null;
  motivo: string | null;
  autor: "asistente" | "dueno" | "sistema" | "mercadopago";
  createdAt: string;
};

export type MensajeDelChat = { de: "cliente" | "asistente" | "dueno"; texto: string; createdAt: string };

/** Espejo de `DetalleVentaPublica`: lo del listado más presupuestos, historial y conversación. */
export type DetalleVenta = Venta & {
  notaDevolucion: string | null;
  presupuestos: Presupuesto[];
  eventos: EventoPedido[];
  mensajes: MensajeDelChat[];
};

export type Totales = {
  cobradoCentavos: number;
  pagadas: number;
  ticketPromedioCentavos: number;
  pendienteCentavos: number;
  pendientes: number;
  /** Pedidos a medida que esperan precio: no suman plata. */
  porCotizar: number;
};

export type ListadoVentas = {
  ventas: Venta[];
  total: number;
  pagina: number;
  porPagina: number;
  totales: Totales;
  rango: { primerDia: string; ultimoDia: string };
};

export type ResumenVentas = {
  rango: { primerDia: string; ultimoDia: string };
  porDia: Array<{ dia: string; cobradoCentavos: number; ventas: number }>;
  topProductos: Array<{ codigo: string; nombreProducto: string; unidades: number; cobradoCentavos: number }>;
};

export type FiltrosVentas = {
  desde: string;
  hasta: string;
  estado?: EstadoVenta;
  q?: string;
  incluirPrueba?: boolean;
  pagina?: number;
};

export const ETIQUETA_ESTADO: Record<EstadoVenta, string> = {
  solicitado: "Solicitado",
  a_cotizar: "A cotizar",
  cotizado: "Cotizado",
  pendiente_pago: "Pendiente de pago",
  pagada: "Pagada",
  cancelada: "Cancelada",
  vencida: "Vencida",
};

function query(filtros: FiltrosVentas): string {
  const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.q?.trim()) params.set("q", filtros.q.trim());
  if (filtros.incluirPrueba) params.set("incluirPrueba", "true");
  if (filtros.pagina && filtros.pagina > 1) params.set("pagina", String(filtros.pagina));
  return params.toString();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

export function listarVentas(filtros: FiltrosVentas): Promise<ListadoVentas> {
  return apiFetch(`/ventas?${query(filtros)}`).then((res) => json<ListadoVentas>(res));
}

export function resumenVentas(filtros: FiltrosVentas): Promise<ResumenVentas> {
  const { desde, hasta, incluirPrueba } = filtros;
  return apiFetch(`/ventas/resumen?${query({ desde, hasta, incluirPrueba })}`).then((res) => json<ResumenVentas>(res));
}

/** Por qué un pedido pasó a una persona (espejo de `ETIQUETA_MOTIVO` en la API). */
export const ETIQUETA_MOTIVO: Record<string, string> = {
  falta_info: "Falta información que el asistente no puede conseguir",
  excepcion: "Pide algo fuera de lo habitual",
  pide_persona: "Quiere hablar con una persona",
  sin_reglas: "No hay cómo cotizarlo automáticamente",
  dueno: "Lo tomaste vos",
  otro: "Otro motivo",
};

export function obtenerVenta(id: string): Promise<DetalleVenta> {
  return apiFetch(`/ventas/${encodeURIComponent(id)}`).then((res) => json<DetalleVenta>(res));
}

function postar<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  return apiFetch(ruta, {
    method: "POST",
    ...(cuerpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }),
  }).then((res) => json<T>(res));
}

export function marcarPagada(id: string): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/pagada`);
}

export function cancelarVenta(id: string): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/cancelar`);
}

/** Los pedidos que atendés vos (el asistente está callado en esos chats), de cualquier fecha. */
export function listarEnAtencion(): Promise<Venta[]> {
  return apiFetch("/ventas/atencion").then((res) => json<Venta[]>(res));
}

/** "Atender yo" (`humana: true`) o "Devolver al asistente", con una nota para el asistente. */
export function cambiarAtencion(id: string, humana: boolean, nota?: string): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/atencion`, { humana, ...(nota?.trim() ? { nota: nota.trim() } : {}) });
}

export type PresupuestoAGuardar = {
  renglones: Array<Pick<RenglonPresupuesto, "concepto" | "tipo" | "cantidad" | "unidad" | "precioUnitarioCentavos">>;
  estimativo: boolean;
  detalleAlCliente: boolean;
  nota?: string;
  /** true: se le manda al cliente en el mismo paso. */
  enviar?: boolean;
};

export function crearPresupuesto(id: string, presupuesto: PresupuestoAGuardar): Promise<DetalleVenta & { mandado?: boolean }> {
  return postar(`/ventas/${encodeURIComponent(id)}/presupuestos`, presupuesto);
}

/** Un borrador calculado con la receta del producto y las respuestas del pedido. */
export function presupuestoDesdeReceta(id: string): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/presupuestos/desde-receta`);
}

export function enviarPresupuesto(id: string, presupuestoId: string): Promise<DetalleVenta & { mandado: boolean }> {
  return postar(`/ventas/${encodeURIComponent(id)}/presupuestos/${encodeURIComponent(presupuestoId)}/enviar`);
}

export function descartarPresupuesto(id: string, presupuestoId: string): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/presupuestos/${encodeURIComponent(presupuestoId)}/descartar`);
}

/** Genera el cobro del presupuesto vigente sin esperar a que el cliente diga que sí. */
export function cobrarPedido(id: string, medioPago?: "mercadopago" | "manual"): Promise<DetalleVenta> {
  return postar(`/ventas/${encodeURIComponent(id)}/cobrar`, medioPago ? { medioPago } : {});
}

/** El producto que se vende en un pedido: los renglones cobrados o, a medida, lo que se pidió. */
export function resumenDeVenta(venta: Pick<Venta, "items" | "solicitud">): string {
  if (venta.items.length > 0) {
    return venta.items
      .map((item) => `${item.cantidad} × ${item.nombreProducto}${item.nombreVariante ? ` (${item.nombreVariante})` : ""}`)
      .join(", ");
  }
  return venta.solicitud?.nombreProducto ? `A medida: ${venta.solicitud.nombreProducto}` : "Pedido a medida";
}

/** Descarga el CSV con los mismos filtros que la pantalla (sin paginar). */
export async function descargarCsv(filtros: FiltrosVentas): Promise<void> {
  const res = await apiFetch(`/ventas/export.csv?${query({ ...filtros, pagina: undefined })}`);
  if (!res.ok) throw new ErrorDeApi("No pudimos exportar las ventas.");
  const url = URL.createObjectURL(await res.blob());
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `ventas-${filtros.desde}-a-${filtros.hasta}.csv`;
  enlace.click();
  URL.revokeObjectURL(url);
}

// --- Fechas en la zona del negocio ------------------------------------------------

const ZONA = "America/Argentina/Buenos_Aires";
const CLAVE_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA });

/** "YYYY-MM-DD" de un instante en Buenos Aires. */
export function claveDia(fecha: Date): string {
  return CLAVE_DIA.format(fecha);
}

/** Suma días a un "YYYY-MM-DD" (a mediodía, así el cambio de día nunca depende del huso). */
export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00-03:00`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return claveDia(fecha);
}

export type Periodo = "hoy" | "7" | "30" | "mes" | "personalizado";

export function rangoDePeriodo(periodo: Exclude<Periodo, "personalizado">, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hoy = claveDia(ahora);
  if (periodo === "hoy") return { desde: hoy, hasta: hoy };
  if (periodo === "mes") return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  return { desde: sumarDias(hoy, -(Number(periodo) - 1)), hasta: hoy };
}

const FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "26/9, 17:42". */
export function fechaCorta(iso: string): string {
  return FECHA_CORTA.format(new Date(iso));
}

/** "26/9" de un "YYYY-MM-DD". */
export function diaCorto(dia: string): string {
  return `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;
}

const DIA_SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, weekday: "short" });

/** "sáb 26/9" de un "YYYY-MM-DD". */
export function diaConSemana(dia: string): string {
  return `${DIA_SEMANA.format(new Date(`${dia}T12:00:00-03:00`)).replace(".", "")} ${diaCorto(dia)}`;
}

const COMPACTO = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

/** "$ 12,9 M" para los montos grandes de los ejes y las tarjetas. */
export function pesosCompactos(centavos: number): string {
  return `$ ${COMPACTO.format(centavos / 100)}`;
}
