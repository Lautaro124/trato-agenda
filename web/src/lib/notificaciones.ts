import { apiFetch } from "./api";

/** Espejo de `Notificacion` en la API. */
export type Notificacion = {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string;
  /** Ruta del panel a la que lleva, o null. */
  enlace: string | null;
  leidaAt: string | null;
  createdAt: string;
};

export type ListadoNotificaciones = {
  notificaciones: Notificacion[];
  total: number;
  noLeidas: number;
  pagina: number;
  porPagina: number;
};

export function contarNoLeidas(): Promise<number> {
  return apiFetch("/notificaciones/no-leidas")
    .then((res) => (res.ok ? (res.json() as Promise<{ cantidad: number }>) : { cantidad: 0 }))
    .then((datos) => datos.cantidad);
}

export function listarNotificaciones(): Promise<ListadoNotificaciones | null> {
  return apiFetch("/notificaciones").then((res) => (res.ok ? (res.json() as Promise<ListadoNotificaciones>) : null));
}

export function marcarLeida(id: string): Promise<void> {
  return apiFetch(`/notificaciones/${id}/leida`, { method: "POST" }).then(() => undefined);
}

export function marcarTodasLeidas(): Promise<void> {
  return apiFetch("/notificaciones/leidas", { method: "POST" }).then(() => undefined);
}

const RELATIVO = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });

/** "hace 5 minutos", "ayer". */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const segundos = Math.round((new Date(iso).getTime() - ahora) / 1000);
  const abs = Math.abs(segundos);
  if (abs < 60) return "recién";
  if (abs < 3600) return RELATIVO.format(Math.round(segundos / 60), "minute");
  if (abs < 86400) return RELATIVO.format(Math.round(segundos / 3600), "hour");
  return RELATIVO.format(Math.round(segundos / 86400), "day");
}
