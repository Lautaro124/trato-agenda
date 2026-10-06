/**
 * Control de la respuesta final del asistente de ventas, todo código. Las
 * reglas del prompt ya prohíben inventar precios, pero el modelo igual lo hacía
 * cuando le pedían algo que no está en el catálogo. Acá se revisa cada monto
 * "$ …" de la respuesta contra lo que de verdad le llegó en esta charla
 * (resultados del catálogo, pedidos, lo que escribió el cliente):
 *
 * - si hay alguno sin respaldo, se descarta la respuesta y el modelo vuelve a
 *   intentarlo con una nota que le dice qué corregir;
 * - si en el segundo intento insiste, se reemplaza por una pregunta fija y se
 *   avisa a Sentry (sólo códigos e ids, nunca el texto).
 */
import { AIMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { avisarASentry } from '../../../observabilidad/aviso-a-sentry.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import { MENSAJE_PRECIO_SIN_VERIFICAR } from '../../mensajes.js';
import { correccionDePrecios, preciosSinRespaldo } from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

function textoDe(mensaje: BaseMessage): string {
  return typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
}

/**
 * De dónde puede salir un monto: el prompt (pedidos) y los resultados de
 * herramientas; aparte, lo que dijo el cliente, que sólo vale tal cual.
 */
export function fuentesDeMontos(state: Pick<EstadoVentasValue, 'messages' | 'inicioVisible' | 'contexto'>): {
  fuentes: string[];
  delCliente: string[];
} {
  const visibles = mensajesVisibles(state.messages, state.inicioVisible ?? 0);
  return {
    fuentes: [
      state.contexto.bloqueSistema,
      ...visibles.filter((mensaje) => mensaje.getType() === 'tool').map(textoDe),
    ],
    delCliente: visibles.filter((mensaje) => mensaje.getType() === 'human').map(textoDe),
  };
}

export function crearNodoVerificarRespuesta() {
  const logger = new Logger('VerificarRespuestaNode');

  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const ultimo = state.messages.at(-1);
    if (!ultimo || ultimo.getType() !== 'ai' || !ultimo.id) return {};

    const { fuentes, delCliente } = fuentesDeMontos(state);
    const sinRespaldo = preciosSinRespaldo(textoDe(ultimo), fuentes, delCliente);
    if (sinRespaldo.length === 0) return {};

    const { conversation, agent } = state.contexto;
    if (!state.correccion) {
      logger.warn(`Precio sin respaldo en la conversación ${conversation.id}: se le pide al modelo que corrija.`);
      return { messages: [new RemoveMessage({ id: ultimo.id })], correccion: correccionDePrecios(sinRespaldo) };
    }

    logger.warn(`Precio sin respaldo otra vez en la conversación ${conversation.id}: se responde la pregunta fija.`);
    avisarASentry('El asistente de ventas insistió con un precio que no sale del catálogo', {
      fingerprint: ['precio-sin-respaldo'],
      tags: { conversacion: conversation.id, montos: sinRespaldo.length },
      userId: agent.userId,
    });
    // Mismo id: el reducer reemplaza la respuesta inventada en vez de sumar otra.
    return { messages: [new AIMessage({ id: ultimo.id, content: MENSAJE_PRECIO_SIN_VERIFICAR })] };
  };
}
