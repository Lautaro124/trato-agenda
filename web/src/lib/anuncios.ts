import { API_URL, apiFetch } from "./api";
import { ErrorDeApi } from "./productos";

/** Cómo quedó el producto de un anuncio. Espejo de `Asociacion` en la API. */
export type Asociacion = "pendiente" | "automatica" | "manual" | "sin_producto";

/** Espejo de `AnuncioPublico` en la API (LAU-103). */
export type Anuncio = {
  id: string;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  cuerpo: string | null;
  tieneMiniatura: boolean;
  asociacion: Asociacion;
  producto: { id: string; nombre: string; activo: boolean } | null;
  chats: number;
  /** `null`: lo cargó el dueño y todavía no llegó ningún chat. */
  ultimoChatAt: string | null;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(res.status < 500 && mensaje ? mensaje : "No pudimos completar la operación.");
  }
  return (await res.json()) as T;
}

export function listarAnuncios() {
  return apiFetch("/anuncios").then((res) => json<Anuncio[]>(res));
}

/** `productoId: null`: el anuncio no es de un producto del catálogo. */
export function asociarAnuncio(id: string, productoId: string | null) {
  return apiFetch(`/anuncios/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productoId }),
  }).then((res) => json<Anuncio>(res));
}

/** Carga un anuncio antes de que llegue un chat: `anuncio` es el ID de Meta o el link. */
export function crearAnuncio(datos: { anuncio: string; productoId: string; nombre?: string }) {
  return apiFetch("/anuncios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  }).then((res) => json<Anuncio>(res));
}

/** Quita un anuncio cargado por error (sólo los que todavía no tienen consultas). */
export async function eliminarAnuncio(id: string): Promise<void> {
  const res = await apiFetch(`/anuncios/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) await json<never>(res);
}

export function urlMiniaturaAnuncio(id: string): string {
  return `${API_URL}/anuncios/${encodeURIComponent(id)}/miniatura`;
}
