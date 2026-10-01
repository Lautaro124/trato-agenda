/**
 * Único nodo del grafo que llama al modelo: el que habla con el cliente. No
 * ejecuta herramientas ni toca Google — sólo decide qué contestar y qué tool
 * calls pedir. La validación y la escritura quedan en los nodos de código.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { esAccionValida } from '../../../agents/agent-catalog.js';
import { resumenDeError } from '../../../agents/openrouter.client.js';
import { avisarASentry } from '../../../observabilidad/aviso-a-sentry.js';
import { MENSAJE_DISCULPA_GENERICO, MENSAJE_FUERA_DE_ALCANCE } from '../../mensajes.js';
import { clasificarFalloDelModelo } from '../../respuesta-sin-choices.js';
import { ESQUEMAS_ACCIONES, ESQUEMAS_PROPIETARIO, type EsquemaHerramienta } from '../../conversation-tools.js';
import type { EstadoComun } from '../state.js';

export type DepsConversacion = {
  llm: BaseChatModel;
  /**
   * Qué herramientas ve el modelo. Por defecto las de la agenda; el grafo de
   * ventas pasa las suyas (ventas-tools.ts).
   */
  herramientas?: (allowedActions: string[], esPropietario: boolean) => EsquemaHerramienta[];
};

/** Herramientas visibles para este agente: las habilitadas + las del dueño si corresponde. */
export function herramientasDisponibles(
  allowedActions: string[],
  esPropietario: boolean,
): EsquemaHerramienta[] {
  return [
    ...allowedActions.filter(esAccionValida).map((id) => ESQUEMAS_ACCIONES[id]),
    ...(esPropietario ? Object.values(ESQUEMAS_PROPIETARIO) : []),
  ];
}

export function crearNodoConversacion(deps: DepsConversacion) {
  const logger = new Logger('ConversacionNode');

  const elegirHerramientas = deps.herramientas ?? herramientasDisponibles;

  return async (state: EstadoComun): Promise<{ messages: BaseMessage[] }> => {
    const { contexto } = state;
    const herramientas = elegirHerramientas(contexto.agent.allowedActions, state.esPropietario);
    const modelo =
      herramientas.length > 0 && deps.llm.bindTools
        ? deps.llm.bindTools(herramientas)
        : deps.llm;

    try {
      const respuesta = await modelo.invoke([
        new SystemMessage(contexto.bloqueSistema),
        ...state.messages,
      ]);
      return { messages: [respuesta] };
    } catch (error) {
      // Se responde como si fuera el turno final: sin tool calls, el router
      // manda directo a persistir y termina la vuelta.
      const fallo = clasificarFalloDelModelo(error);
      if (fallo.motivo === 'otro') {
        logger.error(
          `El modelo falló para la conversación ${contexto.conversation.id}: ${resumenDeError(error)}`,
        );
        return { messages: [new AIMessage(MENSAJE_DISCULPA_GENERICO)] };
      }

      // El proveedor rechazó o no devolvió nada: no es un bug nuestro y suele
      // ser un mensaje que alguien manda para probar los límites del bot. Se
      // registra aparte (warning, fingerprint propio) y sólo con códigos.
      logger.warn(
        `El proveedor del modelo no respondió para la conversación ${contexto.conversation.id}: ${fallo.motivo} (${fallo.codigo ?? 'sin código'})`,
      );
      avisarASentry('El proveedor del modelo no respondió', {
        fingerprint: ['modelo-sin-respuesta', fallo.motivo],
        tags: {
          motivo: fallo.motivo,
          codigo: fallo.codigo,
          proveedor: fallo.proveedor,
          conversacion: contexto.conversation.id,
        },
        userId: contexto.agent.userId,
      });
      const texto = fallo.motivo === 'rechazo_contenido' ? MENSAJE_FUERA_DE_ALCANCE : MENSAJE_DISCULPA_GENERICO;
      return { messages: [new AIMessage(texto)] };
    }
  };
}
