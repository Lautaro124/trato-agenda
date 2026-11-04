import { API_URL, apiFetch } from "./api";
import { ErrorDeApi, type FotoDeProducto } from "./productos";

/**
 * Fotos de productos. La API es la que valida y recomprime (JPEG de 800 px,
 * sin metadatos, comercio/imagenes.rules.ts); acá sólo se achica antes de
 * subir, para que una foto de celular no choque con el tope de peso y viaje
 * menos.
 */

/** Formatos que acepta la API. iOS convierte solo las HEIC a JPEG al elegirlas con este `accept`. */
export const FORMATOS_FOTO = "image/jpeg,image/png,image/webp";

/** Tope de subida de la API (MAX_BYTES_SUBIDA). */
const MAX_BYTES_SUBIDA = 2 * 1024 * 1024;

/** Lado mayor con el que se sube: la API igual la deja en 800. */
const LADO_SUBIDA = 1600;

/** Fotos por producto: la principal y hasta tres de detalle (MAX_IMAGENES_POR_PRODUCTO de la API). */
export const MAX_FOTOS_POR_PRODUCTO = 4;

export type UsoDeImagenes = { usadas: number; maximo: number };

/** Dónde vive la foto principal del producto. */
function rutaImagen(productoId: string): string {
  return `/productos/${encodeURIComponent(productoId)}/imagen`;
}

/** Dónde viven las fotos del producto (o una, con `imagenId`). */
function rutaFotos(productoId: string, imagenId?: string): string {
  const base = `/productos/${encodeURIComponent(productoId)}/imagenes`;
  return imagenId ? `${base}/${encodeURIComponent(imagenId)}` : base;
}

/** URL de la foto principal; `version` (imagenActualizada) evita mostrar una cacheada vieja. */
export function urlImagenProducto(productoId: string, version: string): string {
  return `${API_URL}${rutaImagen(productoId)}?${new URLSearchParams({ v: version })}`;
}

/** URL de una foto puntual; `version` (su `actualizada`) evita mostrar una cacheada vieja. */
export function urlFotoProducto(productoId: string, imagenId: string, version: string): string {
  return `${API_URL}${rutaFotos(productoId, imagenId)}?${new URLSearchParams({ v: version })}`;
}

async function mensajeDeError(res: Response): Promise<string> {
  const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
  if (res.status === 413) return "La foto pesa demasiado: probá con otra.";
  return res.status < 500 && mensaje ? mensaje : "No pudimos subir la foto. Probá de nuevo.";
}

/**
 * Achica la foto en el navegador (JPEG, lado mayor `LADO_SUBIDA`). Si el
 * navegador no puede leerla, se manda tal cual y que la API diga qué pasa.
 */
export async function achicarParaSubir(archivo: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_SUBIDA / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const contexto = canvas.getContext("2d");
    if (!contexto) return archivo;
    // Fondo blanco: lo transparente de un PNG no queda negro en el JPEG.
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, "image/jpeg", 0.85));
    return blob && blob.size < archivo.size ? blob : archivo;
  } catch {
    return archivo;
  }
}

/** Valida y achica la foto antes de mandarla: el cuerpo multipart que espera la API. */
async function cuerpoDeFoto(archivo: File): Promise<FormData> {
  if (!FORMATOS_FOTO.split(",").includes(archivo.type)) {
    throw new ErrorDeApi("La foto tiene que ser JPG, PNG o WebP.");
  }
  const blob = await achicarParaSubir(archivo);
  if (blob.size > MAX_BYTES_SUBIDA) throw new ErrorDeApi("La foto pesa demasiado: probá con otra.");
  const datos = new FormData();
  datos.append("imagen", blob, "foto.jpg");
  return datos;
}

async function fotosDe(res: Response, error: string): Promise<FotoDeProducto[]> {
  if (!res.ok) throw new ErrorDeApi(res.status === 404 || res.status === 409 ? await mensajeDeError(res) : error);
  return (await res.json()) as FotoDeProducto[];
}

/** Suma una foto al final (la primera queda como principal). Devuelve todas, en orden. */
export async function agregarFotoProducto(productoId: string, archivo: File): Promise<FotoDeProducto[]> {
  const res = await apiFetch(rutaFotos(productoId), { method: "POST", body: await cuerpoDeFoto(archivo) });
  if (!res.ok) throw new ErrorDeApi(await mensajeDeError(res));
  return (await res.json()) as FotoDeProducto[];
}

/** Cambia una foto por otra sin moverla de lugar. */
export async function reemplazarFotoProducto(productoId: string, imagenId: string, archivo: File): Promise<FotoDeProducto[]> {
  const res = await apiFetch(rutaFotos(productoId, imagenId), { method: "PUT", body: await cuerpoDeFoto(archivo) });
  if (!res.ok) throw new ErrorDeApi(await mensajeDeError(res));
  return (await res.json()) as FotoDeProducto[];
}

export async function hacerPrincipalFotoProducto(productoId: string, imagenId: string): Promise<FotoDeProducto[]> {
  const res = await apiFetch(`${rutaFotos(productoId, imagenId)}/principal`, { method: "POST" });
  return fotosDe(res, "No pudimos cambiar la foto principal. Probá de nuevo.");
}

export async function quitarFotoProducto(productoId: string, imagenId: string): Promise<FotoDeProducto[]> {
  const res = await apiFetch(rutaFotos(productoId, imagenId), { method: "DELETE" });
  return fotosDe(res, "No pudimos quitar la foto. Probá de nuevo.");
}

export async function usoDeImagenes(): Promise<UsoDeImagenes> {
  const res = await apiFetch("/productos/imagenes/uso");
  if (!res.ok) throw new ErrorDeApi("No pudimos ver cuántas fotos tenés.");
  return (await res.json()) as UsoDeImagenes;
}
