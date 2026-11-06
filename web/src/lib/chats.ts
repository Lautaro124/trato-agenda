import { apiFetch } from "./api";
import { ErrorDeApi } from "./productos";
import { ETIQUETA_ESTADO, type EstadoVenta } from "./ventas";

/** Tope de un mensaje desde el panel. Copia de LARGO_MAX_MENSAJE_PANEL en api/src/chats/chats.types.ts. */
export const LARGO_MAX_MENSAJE = 1000;
/** Tope de la nota al devolver el chat. Copia de LARGO_MAX_NOTA en api/src/comercio/ventas.rules.ts. */
export const LARGO_MAX_NOTA = 500;

/** "asistente": contesta el bot. "humana": contestás vos. */
export type AtencionChat = "asistente" | "humana";

export type MensajeChat = {
  id: string;
  /** "dueno" es lo que escribiste vos, desde el panel o desde tu teléfono. */
  de: "cliente" | "asistente" | "dueno";
  texto: string;
  createdAt: string;
};

export type ChatResumen = {
  id: string;
  nombre: string | null;
  telefono: string | null;
  atencion: AtencionChat;
  ultimo: Omit<MensajeChat, "id"> | null;
  teEspera: boolean;
  turno: { inicio: string } | null;
  pedido: { estado: string } | null;
};

export type ListaChats = {
  chats: ChatResumen[];
  cuenta: { todos: number; asistente: number; humana: number };
};

export type DetalleChat = { chat: ChatResumen; mensajes: MensajeChat[] };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

function postar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  return apiFetch(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  }).then((res) => json<T>(res));
}

export function listarChats(): Promise<ListaChats> {
  return apiFetch("/chats").then((res) => json<ListaChats>(res));
}

export function obtenerChat(id: string): Promise<DetalleChat> {
  return apiFetch(`/chats/${encodeURIComponent(id)}`).then((res) => json<DetalleChat>(res));
}

export function tomarControl(id: string): Promise<{ chat: ChatResumen; contesta: boolean }> {
  return postar(`/chats/${encodeURIComponent(id)}/atencion`, { humana: true });
}

/**
 * Le devuelve el chat al bot. `contestar`: que responda lo que el cliente
 * escribió sin respuesta, con la nota como contexto. Si no, espera al
 * próximo mensaje ("Ya lo resolví").
 */
export function devolverAlBot(
  id: string,
  opciones: { contestar: boolean; nota?: string },
): Promise<{ chat: ChatResumen; contesta: boolean }> {
  const nota = opciones.contestar ? opciones.nota?.trim() : undefined;
  return postar(`/chats/${encodeURIComponent(id)}/atencion`, {
    humana: false,
    contestar: opciones.contestar,
    ...(nota ? { nota } : {}),
  });
}

/** `clave` evita mandarlo dos veces si se reintenta: la misma clave para el mismo mensaje. */
export function enviarMensaje(id: string, texto: string, clave: string): Promise<MensajeChat> {
  return postar(`/chats/${encodeURIComponent(id)}/mensajes`, { texto, clave });
}

// --- Cómo se muestra ------------------------------------------------------------------

/** El nombre que dio el cliente; si no, su número; si tampoco, algo genérico. */
export function nombreDe(chat: Pick<ChatResumen, "nombre" | "telefono">): string {
  if (chat.nombre) return chat.nombre;
  if (chat.telefono) return `+${chat.telefono}`;
  return "Cliente sin número";
}

export function inicialDe(chat: Pick<ChatResumen, "nombre" | "telefono">): string {
  return chat.nombre?.trim().charAt(0).toUpperCase() || "#";
}

const ZONA = "America/Argentina/Buenos_Aires";
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DIA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "numeric", month: "short" });
const TURNO = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, weekday: "short", day: "numeric" });
const CLAVE_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA });

/** "10:42" si es de hoy, "Ayer" o "3 nov." si no. */
export function horaCorta(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  const dia = CLAVE_DIA.format(fecha);
  if (dia === CLAVE_DIA.format(ahora)) return HORA.format(fecha);
  if (dia === CLAVE_DIA.format(new Date(ahora.getTime() - 24 * 60 * 60_000))) return "Ayer";
  return DIA.format(fecha);
}

export function horaDeMensaje(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  const hora = HORA.format(fecha);
  return CLAVE_DIA.format(fecha) === CLAVE_DIA.format(ahora) ? hora : `${horaCorta(iso, ahora)} · ${hora}`;
}

/** El contexto del negocio en una línea: el próximo turno o el pedido abierto. */
export function contextoDe(chat: Pick<ChatResumen, "turno" | "pedido">): string | null {
  if (chat.turno) {
    const fecha = new Date(chat.turno.inicio);
    return `Turno ${TURNO.format(fecha)} · ${HORA.format(fecha)}`;
  }
  if (chat.pedido) {
    const estado = ETIQUETA_ESTADO[chat.pedido.estado as EstadoVenta] ?? chat.pedido.estado;
    return `Pedido · ${estado.toLowerCase()}`;
  }
  return null;
}
