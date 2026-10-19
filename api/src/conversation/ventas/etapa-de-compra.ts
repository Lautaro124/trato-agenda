/**
 * En qué punto de la compra está el cliente, decidido por Jev y no por el
 * modelo de chat: con la regla de "cuando ya eligió todo", el modelo pedía
 * los datos de contacto y de envío apenas aparecía un producto, sobre todo
 * con productos a medida, donde todavía faltaba definir medidas o
 * terminación. Lo de acá es puro; la llamada la hace el nodo cargar_contexto.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { EtapaDeCompra } from '../../comercio/datos-cliente.rules.js';
import type { PedidoDeEleccion } from '../../comercio/decisiones.client.js';
import { LARGO_MAX_ESTADO } from '../../comercio/sugerencias.rules.js';

/** Mensajes de la charla (de los dos lados) que lee Jev. */
export const MENSAJES_PARA_ETAPA = 8;

/** Largo máximo de cada mensaje del asistente: un listado largo no aporta a la decisión. */
const LARGO_MAX_RESPUESTA = 300;

const INSTRUCCIONES =
  'The state is a WhatsApp conversation (in Spanish) between a customer and an online shop. Decide whether ' +
  'the customer has finished choosing what to buy, so that the shop can now ask for their contact and ' +
  'shipping details to place the order.';

/**
 * `defining` va primero a propósito: si Jev empata o sólo contesta "ninguna",
 * `ordenar` devuelve este orden, y ante la duda es mejor no pedir datos
 * todavía. Si el cliente igual cierra, crear_pedido rechaza el pedido sin los
 * obligatorios y el modelo los pide en ese momento.
 */
const OPCIONES = {
  defining:
    'The customer is still choosing, comparing or asking questions, or is still describing what they need ' +
    '(for made-to-order products: sizes, color, finish, quantity or other details not settled yet).',
  ready:
    'The customer has finished choosing: they said they want nothing else, asked to pay or to place the ' +
    'order, and nothing about the product is left to define.',
} as const;

const NINGUNA = 'There is no purchase in this conversation yet.';

/**
 * Lo que lee Jev: los últimos mensajes de los dos lados, como "Customer:" y
 * "Shop:", sin número ni nombre (el que sabemos del cliente se tapa: el
 * asistente lo usa al contestar). Hacen falta los dos: un "no" del cliente
 * sólo significa "terminé" después de un "¿querés algo más?". Sin respuestas
 * del asistente (primer mensaje) no hay nada que decidir y da vacío.
 */
export function estadoDeLaCharla(mensajes: BaseMessage[], nombreCliente: string | null = null): string {
  const taparNombre = tapadorDeNombre(nombreCliente);
  const lineas = mensajes
    .filter((mensaje) => {
      const tipo = mensaje.getType();
      return tipo === 'human' || (tipo === 'ai' && typeof mensaje.content === 'string' && mensaje.content.trim());
    })
    .slice(-MENSAJES_PARA_ETAPA)
    .map((mensaje) => {
      const texto = taparDatos(
        taparNombre(
          (typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content)).replace(/\s+/g, ' ').trim(),
        ),
      );
      return mensaje.getType() === 'human' ? `Customer: ${texto}` : `Shop: ${texto.slice(0, LARGO_MAX_RESPUESTA)}`;
    });
  if (!lineas.some((linea) => linea.startsWith('Shop: '))) return '';
  const texto = lineas.join('\n');
  return texto.length > LARGO_MAX_ESTADO ? texto.slice(texto.length - LARGO_MAX_ESTADO) : texto;
}

/**
 * Lo que el cliente da justo en esta etapa (email, DNI, teléfono, código
 * postal) no le hace falta a Jev para decidir: los emails y los números de 4
 * dígitos o más (con puntos, guiones o espacios en medio) se tapan, salvo los
 * precios.
 */
export function taparDatos(texto: string): string {
  return texto
    .replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/\+?\d(?:[\d.\- ]{2,}\d)/g, (numero, desde: number, texto: string) =>
      // Los precios ("$ 300.000") quedan: dicen qué eligió, no quién es.
      numero.replace(/\D/g, '').length >= 4 && !/\$\s?$/.test(texto.slice(0, desde)) ? '[number]' : numero,
    );
}

/** Reemplaza cada palabra del nombre del cliente (sin importar mayúsculas) por "[name]". */
function tapadorDeNombre(nombre: string | null): (texto: string) => string {
  // Con tope: el nombre lo escribe el cliente y no hace falta un patrón enorme.
  const palabras = (nombre ?? '')
    .slice(0, 80)
    .split(/\s+/)
    .slice(0, 5)
    .filter((palabra) => palabra.length >= 2)
    .map((palabra) => palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (palabras.length === 0) return (texto) => texto;
  const patron = new RegExp(`(?<![\\p{L}\\p{N}])(?:${palabras.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return (texto) => texto.replace(patron, '[name]');
}

export function pedidoDeEtapa(estado: string): PedidoDeEleccion {
  return { estado, instrucciones: INSTRUCCIONES, opciones: { ...OPCIONES }, ninguna: NINGUNA };
}

/** El orden que devolvió Jev, como etapa. Sin ninguna de las dos arriba, null: queda la regla de siempre. */
export function etapaDesdeOrden(orden: string[]): EtapaDeCompra | null {
  if (orden[0] === 'ready') return 'lista';
  if (orden[0] === 'defining') return 'eligiendo';
  return null;
}
