/**
 * Que el asistente salude una sola vez por charla. Lo usan los dos grafos
 * (agenda y ventas), así que vive aparte y sin dependencias.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { completarPlantilla, mensajePropio } from '../../agents/mensajes.rules.js';
import type { Agent } from '../../generated/prisma/client.js';

/**
 * Si el asistente ya contestó en este hilo. El último mensaje es el que acaba
 * de llegar; cualquier `ai` antes que él quiere decir que ya hubo saludo.
 */
export function yaSePresento(messages: BaseMessage[]): boolean {
  return messages.slice(0, -1).some((mensaje) => mensaje.getType() === 'ai');
}

/**
 * Para una conversación que ya viene de antes: el modelo ve su propio saludo en
 * el historial, pero igual tiende a volver a presentarse en cada respuesta.
 */
export const YA_TE_PRESENTASTE =
  'Ya te presentaste en esta conversación: no saludes de nuevo ni digas tu nombre, contestá directo lo que te pide.';

/**
 * Lo que se suma al contexto sobre el saludo: YA_TE_PRESENTASTE si ya saludó,
 * o el saludo que escribió el dueño (en /asistente) si es el primer mensaje.
 * El texto del dueño va con `JSON.stringify` para que se lea como dato.
 */
export function bloqueDeSaludo(
  agent: Pick<Agent, 'mensajes' | 'nombreBot' | 'nombreTitular'>,
  yaSePresento: boolean,
): string {
  if (yaSePresento) return `\n\n${YA_TE_PRESENTASTE}`;
  const propio = mensajePropio(agent, 'saludo');
  if (!propio) return '';
  const titular = agent.nombreTitular.trim();
  const saludo = completarPlantilla(propio, {
    asistente: agent.nombreBot.trim(),
    titular,
    negocio: titular,
  });
  return (
    `\n\nTu primer mensaje de esta conversación empieza con este saludo, tal cual: ${JSON.stringify(saludo)}. ` +
    'Si el cliente ya preguntó algo, contestáselo en el mismo mensaje, después del saludo.'
  );
}

/**
 * Lo que el contexto dice de este cliente. No alcanza con mirar
 * `Conversation.resumen`: se calcula cada CADA_CUANTOS_MENSAJES_RESUMIR
 * mensajes, y mientras tanto el contexto decía "Primera vez que te escribe"
 * en cada mensaje — que pesaba más que YA_TE_PRESENTASTE y hacía que el
 * asistente volviera a arrancar con "¡Hola!".
 */
export function memoriaDelCliente(resumen: string | null, yaSePresento: boolean): string {
  if (resumen) return `Ya escribió antes. Resumen de lo que sabés de este cliente: ${resumen}`;
  return yaSePresento ? 'Ya vienen hablando en esta conversación.' : 'Primera vez que te escribe este número.';
}
