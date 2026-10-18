/**
 * Las fotos que el asistente decidió mandar en esta vuelta. El grafo no tiene
 * el socket de WhatsApp: el nodo `catalogo` deja cada foto aprobada como
 * `artifact` de su ToolMessage (sólo los ids y el nombre, nunca los bytes) y
 * la fachada (conversation.service.ts) las junta acá para que WhatsappService
 * las mande antes del texto.
 */
import type { BaseMessage } from '@langchain/core/messages';

export const HERRAMIENTA_IMAGEN = 'enviar_imagen_producto';

/** `varianteId` sólo cuando va la foto propia de una variante fija; si no, la del producto. */
export type ImagenAEnviar = { productoId: string; nombre: string; varianteId?: string };

function esImagenAEnviar(valor: unknown): valor is ImagenAEnviar {
  if (typeof valor !== 'object' || valor === null) return false;
  const { productoId, nombre, varianteId } = valor as Record<string, unknown>;
  return typeof productoId === 'string' && typeof nombre === 'string' && (varianteId === undefined || typeof varianteId === 'string');
}

/** Qué foto es: la del producto o la de una de sus variantes. */
export function claveDeFoto(foto: { productoId: string; varianteId?: string }): string {
  return foto.varianteId ? `${foto.productoId}/${foto.varianteId}` : foto.productoId;
}

/** Las fotos mandadas en estos mensajes, en orden y sin repetir. */
function fotosDe(messages: BaseMessage[]): ImagenAEnviar[] {
  const imagenes: ImagenAEnviar[] = [];
  for (const mensaje of messages) {
    if (mensaje.getType() !== 'tool') continue;
    const { name, artifact } = mensaje as BaseMessage & { artifact?: unknown };
    if (name === HERRAMIENTA_IMAGEN && esImagenAEnviar(artifact)) imagenes.push(artifact);
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
 * modelo: a pedido el asistente las manda solo, y mandar dos veces la misma
 * es ruido.
 */
export function fotosMandadas(messages: BaseMessage[]): Set<string> {
  return new Set(fotosDe(messages).map(claveDeFoto));
}
