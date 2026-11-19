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
 *
 * También revisa que no repita, con su precio, los productos que ya le llegaron
 * en foto con el nombre y el precio al pie (el listado de ver_catalogo): se le
 * pide que corrija y, si insiste, se quitan esas líneas.
 */
import { AIMessage, RemoveMessage, type BaseMessage, type ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { avisarASentry } from '../../../observabilidad/aviso-a-sentry.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import { MENSAJE_CUAL_TE_INTERESA, MENSAJE_PRECIO_SIN_VERIFICAR } from '../../mensajes.js';
import { imagenesDeLaVuelta } from '../imagenes-de-la-vuelta.js';
import { preguntasSinHacer } from '../../../comercio/preguntas-pedido.rules.js';
import {
  correccionDeListaConFotos,
  correccionDeListaRepetida,
  correccionDePreguntasPendientes,
  lineasDeListado,
  correccionDePrecios,
  ofreceCerrar,
  lineasQueRepitenFotos,
  preciosSinRespaldo,
  sinLineasRepetidas,
  type FotoConLeyenda,
} from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

function textoDe(mensaje: BaseMessage): string {
  return typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
}

/** Si en esta vuelta (desde el último mensaje del cliente) una búsqueda mandó fotos de productos. */
function busquedaConFotosEnLaVuelta(messages: BaseMessage[]): boolean {
  let desde = messages.length;
  while (desde > 0 && messages[desde - 1].getType() !== 'human') desde--;
  return messages.slice(desde).some((mensaje) => {
    if (mensaje.getType() !== 'tool' || (mensaje as ToolMessage).name !== 'buscar_productos') return false;
    const artifact = (mensaje as ToolMessage).artifact as unknown;
    return Array.isArray(artifact) && artifact.length > 0;
  });
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

  function verificarFotosRepetidas(state: EstadoVentasValue, id: string, texto: string): EstadoVentasUpdate {
    const fotos: FotoConLeyenda[] = imagenesDeLaVuelta(state.messages).flatMap(({ nombre, leyenda }) =>
      leyenda ? [{ nombre, leyenda }] : [],
    );
    // Si la búsqueda mandó las fotos, ellas son la lista: ningún renglón con precio, de esos productos o de otros.
    const conFotosDeBusqueda = busquedaConFotosEnLaVuelta(state.messages);
    const repetidas = [
      ...new Set([...lineasQueRepitenFotos(texto, fotos), ...(conFotosDeBusqueda ? lineasDeListado(texto) : [])]),
    ];
    if (repetidas.length === 0) return {};

    const { conversation } = state.contexto;
    if (!state.correccion) {
      logger.warn(`Lista repetida de productos en foto en la conversación ${conversation.id}: se le pide al modelo que corrija.`);
      return {
        messages: [new RemoveMessage({ id })],
        correccion: conFotosDeBusqueda ? correccionDeListaConFotos() : correccionDeListaRepetida(),
      };
    }

    logger.warn(`Lista repetida de productos en foto otra vez en la conversación ${conversation.id}: se quitan esas líneas.`);
    // Mismo id: el reducer reemplaza la respuesta en vez de sumar otra.
    return {
      messages: [new AIMessage({ id, content: sinLineasRepetidas(texto, repetidas) ?? MENSAJE_CUAL_TE_INTERESA })],
    };
  }

  /**
   * Las preguntas del pedido (LAU-100) van antes de "¿algo más o te lo
   * anoto?": si ofrece cerrar con preguntas globales sin hacer, se le pide que
   * las haga primero. Una sola vez: si insiste, sale igual y el bloqueo de
   * `crear_pedido` las exige antes de anotar.
   */
  function verificarPreguntasAntesDelCierre(state: EstadoVentasValue, id: string, texto: string): EstadoVentasUpdate {
    const preguntas = state.contexto.preguntas ?? [];
    if (state.correccion || preguntas.length === 0 || !ofreceCerrar(texto)) return {};
    const anteriores = state.messages
      .slice(state.inicioVisible ?? 0, -1)
      .filter((mensaje) => mensaje.getType() === 'ai')
      .map(textoDe);
    const faltan = preguntasSinHacer(preguntas, [], anteriores);
    if (faltan.length === 0) return {};
    logger.warn(`Cierre antes de las preguntas del pedido en la conversación ${state.contexto.conversation.id}: se le pide que pregunte.`);
    return { messages: [new RemoveMessage({ id })], correccion: correccionDePreguntasPendientes(faltan, preguntas) };
  }

  return (state: EstadoVentasValue): EstadoVentasUpdate => {
    const ultimo = state.messages.at(-1);
    if (!ultimo || ultimo.getType() !== 'ai' || !ultimo.id) return {};

    const { fuentes, delCliente } = fuentesDeMontos(state);
    const sinRespaldo = preciosSinRespaldo(textoDe(ultimo), fuentes, delCliente);
    if (sinRespaldo.length === 0) {
      const fotos = verificarFotosRepetidas(state, ultimo.id, textoDe(ultimo));
      if (Object.keys(fotos).length > 0) return fotos;
      return verificarPreguntasAntesDelCierre(state, ultimo.id, textoDe(ultimo));
    }

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
