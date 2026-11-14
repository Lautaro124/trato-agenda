/**
 * Las resoluciones de envío de esta vuelta (LAU-102). El nodo `catalogo` deja
 * la ResolucionEnvio como `artifact` del ToolMessage de consultar_envio (el
 * modelo no la ve) y el probador del panel la muestra junto a la respuesta.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ResolucionEnvio } from '../../envios/envios.rules.js';

const TIPO = 'resolucion_envio';

export type ArtifactEnvio = { tipo: typeof TIPO; resolucion: ResolucionEnvio };

export function artifactDeEnvio(resolucion: ResolucionEnvio): ArtifactEnvio {
  return { tipo: TIPO, resolucion };
}

function esArtifactEnvio(valor: unknown): valor is ArtifactEnvio {
  return typeof valor === 'object' && valor !== null && (valor as { tipo?: unknown }).tipo === TIPO;
}

/** Las resoluciones desde el último mensaje del cliente, en orden. */
export function resolucionesEnvioDeLaVuelta(messages: BaseMessage[]): ResolucionEnvio[] {
  let desde = messages.length;
  while (desde > 0 && messages[desde - 1].getType() !== 'human') desde--;
  return messages
    .slice(desde)
    .filter((m) => m.getType() === 'tool')
    .map((m) => (m as BaseMessage & { artifact?: unknown }).artifact)
    .filter(esArtifactEnvio)
    .map((a) => a.resolucion);
}
