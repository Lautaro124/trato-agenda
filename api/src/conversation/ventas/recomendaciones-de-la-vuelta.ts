/**
 * Lo que resolvió consultar_recomendacion en esta vuelta (LAU-105). Como con
 * los envíos (envios-de-la-vuelta.ts), el nodo `catalogo` deja el resultado
 * como `artifact` del ToolMessage (el modelo no lo ve) y el probador del
 * panel lo muestra junto a la respuesta.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ResultadoRecomendacion } from '../../comercio/recomendaciones.rules.js';

const TIPO = 'resultado_recomendacion';

/**
 * La conversación del probador de recomendaciones del panel. Ahí también
 * cuentan las reglas pausadas: es donde el dueño las prueba antes de activarlas.
 */
export const JID_PRUEBA_RECOMENDACIONES = 'web-test:recomendaciones:';

export function esPruebaDeRecomendaciones(remoteJid: string): boolean {
  return remoteJid.startsWith(JID_PRUEBA_RECOMENDACIONES);
}

export type ArtifactRecomendacion = { tipo: typeof TIPO; resultado: ResultadoRecomendacion };

export function artifactDeRecomendacion(resultado: ResultadoRecomendacion): ArtifactRecomendacion {
  return { tipo: TIPO, resultado };
}

function esArtifactRecomendacion(valor: unknown): valor is ArtifactRecomendacion {
  return typeof valor === 'object' && valor !== null && (valor as { tipo?: unknown }).tipo === TIPO;
}

/** Los resultados desde el último mensaje del cliente, en orden. */
export function recomendacionesDeLaVuelta(messages: BaseMessage[]): ResultadoRecomendacion[] {
  let desde = messages.length;
  while (desde > 0 && messages[desde - 1].getType() !== 'human') desde--;
  return messages
    .slice(desde)
    .filter((m) => m.getType() === 'tool')
    .map((m) => (m as BaseMessage & { artifact?: unknown }).artifact)
    .filter(esArtifactRecomendacion)
    .map((a) => a.resultado);
}
