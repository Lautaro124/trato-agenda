/**
 * Las fotos que el asistente decidió mandar en esta vuelta. El grafo no tiene
 * el socket de WhatsApp: el nodo `catalogo` deja cada foto aprobada como
 * `artifact` de su ToolMessage (sólo el id y el nombre, nunca los bytes) y la
 * fachada (conversation.service.ts) las junta acá para que WhatsappService
 * las mande antes del texto.
 */
import type { BaseMessage } from '@langchain/core/messages';

export const HERRAMIENTA_IMAGEN = 'enviar_imagen_producto';

export type ImagenAEnviar = { productoId: string; nombre: string };

function esImagenAEnviar(valor: unknown): valor is ImagenAEnviar {
  if (typeof valor !== 'object' || valor === null) return false;
  const { productoId, nombre } = valor as Record<string, unknown>;
  return typeof productoId === 'string' && typeof nombre === 'string';
}

/**
 * Fotos aprobadas desde el último mensaje del cliente, en el orden en que se
 * pidieron y sin repetir producto.
 */
export function imagenesDeLaVuelta(messages: BaseMessage[]): ImagenAEnviar[] {
  const imagenes: ImagenAEnviar[] = [];
  for (let indice = messages.length - 1; indice >= 0; indice--) {
    const mensaje = messages[indice];
    if (mensaje.getType() === 'human') break;
    if (mensaje.getType() !== 'tool') continue;
    const { name, artifact } = mensaje as BaseMessage & { artifact?: unknown };
    if (name === HERRAMIENTA_IMAGEN && esImagenAEnviar(artifact)) imagenes.unshift(artifact);
  }
  return imagenes.filter((imagen, indice) => imagenes.findIndex((otra) => otra.productoId === imagen.productoId) === indice);
}
