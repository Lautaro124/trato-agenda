/**
 * Las fotos que el asistente decidió mandar en esta vuelta. El grafo no tiene
 * el socket de WhatsApp: el nodo `catalogo` deja cada foto aprobada como
 * `artifact` de su ToolMessage (sólo los ids y el nombre, nunca los bytes) y
 * la fachada (conversation.service.ts) las junta acá para que WhatsappService
 * las mande antes del texto.
 */
import type { BaseMessage } from '@langchain/core/messages';

export const HERRAMIENTA_IMAGEN = 'enviar_imagen_producto';

/**
 * Sin `imagenId` es la foto principal del producto; con él, una de detalle.
 * `leyenda` es el pie de foto cuando no alcanza con el nombre: las del
 * listado de ver_catalogo van con nombre y precio.
 */
export type ImagenAEnviar = { productoId: string; imagenId?: string; nombre: string; leyenda?: string };

function esImagenAEnviar(valor: unknown): valor is ImagenAEnviar {
  if (typeof valor !== 'object' || valor === null) return false;
  const { productoId, imagenId, nombre, leyenda } = valor as Record<string, unknown>;
  return (
    typeof productoId === 'string' &&
    typeof nombre === 'string' &&
    (imagenId === undefined || typeof imagenId === 'string') &&
    (leyenda === undefined || typeof leyenda === 'string')
  );
}

/** El `artifact` de un ToolMessage: una foto (enviar_imagen_producto) o varias (el listado de ver_catalogo). */
function imagenesDelArtifact(artifact: unknown): ImagenAEnviar[] {
  if (Array.isArray(artifact)) return artifact.filter(esImagenAEnviar);
  return esImagenAEnviar(artifact) ? [artifact] : [];
}

/** Qué foto es: la principal del producto o una de sus fotos de detalle. */
export function claveDeFoto(foto: { productoId: string; imagenId?: string }): string {
  return foto.imagenId ? `${foto.productoId}#${foto.imagenId}` : foto.productoId;
}

/** Las fotos mandadas en estos mensajes, en orden y sin repetir. */
function fotosDe(messages: BaseMessage[]): ImagenAEnviar[] {
  const imagenes: ImagenAEnviar[] = [];
  for (const mensaje of messages) {
    if (mensaje.getType() !== 'tool') continue;
    // Por el artifact y no por el nombre: las del listado vienen en el ToolMessage de ver_catalogo.
    imagenes.push(...imagenesDelArtifact((mensaje as BaseMessage & { artifact?: unknown }).artifact));
  }
  return imagenes.filter((imagen, indice) => imagenes.findIndex((otra) => claveDeFoto(otra) === claveDeFoto(imagen)) === indice);
}

/**
 * Fotos aprobadas desde el último mensaje del cliente, en el orden en que se
 * pidieron y sin repetir.
 */
export function imagenesDeLaVuelta(messages: BaseMessage[]): ImagenAEnviar[] {
  let desde = messages.length;
  while (desde > 0 && messages[desde - 1].getType() !== 'human') desde--;
  return fotosDe(messages.slice(desde));
}

/**
 * Las fotos que ya le llegaron al cliente en la parte de la charla que ve el
 * modelo: el asistente las manda solo, y mandar dos veces la misma es ruido.
 */
export function fotosMandadas(messages: BaseMessage[]): Set<string> {
  return new Set(fotosDe(messages).map(claveDeFoto));
}
