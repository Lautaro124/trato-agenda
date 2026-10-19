/**
 * Validación de las tool calls del asistente de ventas: código puro, sin base
 * ni red. Revisa que la herramienta exista para este agente y que los
 * argumentos cumplan su schema. Lo que rechaza vuelve al modelo como
 * ToolMessage; lo que pasa, lo ejecuta el nodo `catalogo`.
 */
import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { esAccionDeVentas } from '../../../agents/agent-catalog.js';
import { leerConfigDatosCliente, validarDatosPedido } from '../../../comercio/datos-cliente.rules.js';
import { MAX_IMAGENES_POR_MENSAJE } from '../../../comercio/imagenes.rules.js';
import { agruparItems, problemaDeForma, type ItemPedido } from '../../../comercio/ventas.rules.js';
import { LARGO_MAX_CONSULTA } from '../../../notificaciones/avisos.js';
import type { EsquemaHerramienta } from '../../conversation-tools.js';
import { llamadasDe, type OperacionPendiente } from '../../graph/state.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import {
  LARGO_MAX_DETALLE_DERIVACION,
  LARGO_MAX_RESUMEN,
  MAX_RESPUESTAS,
} from '../../../comercio/pedido-a-medida.rules.js';
import { LARGO_MAX_RESPUESTA, MAX_CANTIDAD_VARIANTE_FIJA } from '../../../comercio/solicitud.rules.js';
import { estadoVisible } from '../../../comercio/ventas.rules.js';
import { MAX_BUSQUEDAS_POR_MENSAJE, productosMostrados, variantesMostradas } from '../reglas-ventas.js';
import { claveDeFoto, fotosMandadas, HERRAMIENTA_IMAGEN, imagenesDeLaVuelta } from '../imagenes-de-la-vuelta.js';
import { accionesDeVentas, ESQUEMAS_PROPIETARIO_VENTAS, ESQUEMAS_VENTAS } from '../ventas-tools.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

/** Largo máximo de una consulta al catálogo: lo que pase de eso no es una búsqueda. */
export const MAX_LARGO_CONSULTA = 200;

/** Largo máximo de un id de producto: un cuid tiene 25. */
const MAX_LARGO_ID = 64;

type Veredicto = { ok: true; operacion: OperacionPendiente } | { ok: false; motivo: string };

/** Lo que la validación necesita saber de la charla, además de la llamada. */
export type HistorialValidacion = {
  /** buscar_productos ya aprobadas en este mensaje del cliente. */
  busquedasEnElMensaje: number;
  /** Ids de variante que aparecieron en búsquedas dentro de la ventana que ve el modelo. */
  variantesVistas: Set<string>;
  /** Ids de producto ("[producto …]") de búsquedas y del catálogo dentro de la ventana. */
  productosVistos: Set<string>;
  /**
   * Productos cuya foto ya sale en esta vuelta: las que mandó el nodo
   * `catalogo` desde el último mensaje del cliente más las aprobadas en esta
   * misma respuesta. Con eso vale `MAX_IMAGENES_POR_MENSAJE` aunque el modelo
   * las pida de a una, en varias idas y vueltas.
   */
  fotosEnElMensaje: Set<string>;
  /** Con productos a medida: fotos (claveDeFoto) que ya le llegaron al cliente en la parte de la charla que ve el modelo. */
  fotosYaMandadas: Set<string>;
};

/** Cuenta las búsquedas de esta vuelta y junta las variantes que se le mostraron al modelo. */
export function historialValidacion(state: EstadoVentasValue): HistorialValidacion {
  const textoDe = (mensaje: BaseMessage) =>
    typeof mensaje.content === 'string' ? mensaje.content : JSON.stringify(mensaje.content);
  const resultados = mensajesVisibles(state.messages, state.inicioVisible ?? 0).filter(
    (mensaje) => mensaje.getType() === 'tool',
  );
  return {
    busquedasEnElMensaje: state.messages
      .slice(state.indiceDesde ?? 0)
      .filter((mensaje) => mensaje.getType() === 'tool' && (mensaje as ToolMessage).name === 'buscar_productos').length,
    // Por el contenido y no por el nombre: los ToolMessage sembrados desde la tabla Message no lo traen.
    variantesVistas: variantesMostradas(resultados.map(textoDe)),
    productosVistos: productosMostrados(resultados.map(textoDe)),
    fotosEnElMensaje: new Set(imagenesDeLaVuelta(state.messages.slice(state.indiceDesde ?? 0)).map(claveDeFoto)),
    // Con productos a medida el asistente las manda solo: ahí se corta repetir una. Si no, sólo salen cuando las piden.
    fotosYaMandadas: state.contexto.tieneAMedida
      ? fotosMandadas(mensajesVisibles(state.messages, state.inicioVisible ?? 0))
      : new Set(),
  };
}

function esquemaPara(state: EstadoVentasValue, nombre: string): EsquemaHerramienta | undefined {
  const { agent, tieneAMedida } = state.contexto;
  if (esAccionDeVentas(nombre) && accionesDeVentas(agent.allowedActions, { aMedida: tieneAMedida }).includes(nombre)) {
    return ESQUEMAS_VENTAS[nombre];
  }
  if (state.esPropietario) return ESQUEMAS_PROPIETARIO_VENTAS[nombre];
  return undefined;
}

export function validarLlamadaVentas(
  state: EstadoVentasValue,
  llamada: OperacionPendiente,
  historial: HistorialValidacion,
): Veredicto {
  const esquema = esquemaPara(state, llamada.nombre);
  if (!esquema) {
    return { ok: false, motivo: `La herramienta ${llamada.nombre} no existe. Usá sólo las que tenés disponibles.` };
  }
  const parseo = esquema.schema.safeParse(llamada.args);
  if (!parseo.success) {
    return {
      ok: false,
      motivo: `Argumentos inválidos para ${llamada.nombre}: ${parseo.error.issues.map((issue) => issue.message).join('; ')}.`,
    };
  }
  const args = parseo.data;

  if (llamada.nombre === 'buscar_productos' || llamada.nombre === 'consultar_stock') {
    const consulta = String(args.consulta ?? '').trim();
    if (!consulta) return { ok: false, motivo: 'La consulta está vacía: decí qué producto buscás.' };
    if (consulta.length > MAX_LARGO_CONSULTA) {
      return { ok: false, motivo: `La consulta es demasiado larga: resumila en menos de ${MAX_LARGO_CONSULTA} caracteres.` };
    }
    if (llamada.nombre === 'buscar_productos' && historial.busquedasEnElMensaje >= MAX_BUSQUEDAS_POR_MENSAJE) {
      return {
        ok: false,
        motivo:
          `Ya buscaste ${MAX_BUSQUEDAS_POR_MENSAJE} veces para este mensaje. Si no apareció lo que pide, no lo ` +
          'tenés: decíselo al cliente sin inventar precio ni stock, y preguntale si busca otra cosa.',
      };
    }
    return { ok: true, operacion: { ...llamada, args: { ...args, consulta } } };
  }

  if (llamada.nombre === 'ver_catalogo') {
    const categoria = typeof args.categoria === 'string' ? args.categoria.trim() : '';
    if (categoria.length > MAX_LARGO_CONSULTA) {
      return { ok: false, motivo: `La categoría es demasiado larga: usá el nombre tal como se la sugeriste.` };
    }
    return { ok: true, operacion: { ...llamada, args: categoria ? { categoria } : {} } };
  }

  if (llamada.nombre === 'ver_descuentos') {
    return { ok: true, operacion: { ...llamada, args: {} } };
  }

  if (llamada.nombre === 'listar_ventas' || llamada.nombre === 'resumen_ventas') {
    for (const campo of ['desde', 'hasta'] as const) {
      const valor = args[campo];
      if (valor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) {
        return { ok: false, motivo: `${campo} tiene que ser un día AAAA-MM-DD.` };
      }
    }
    return { ok: true, operacion: { ...llamada, args } };
  }

  if (llamada.nombre === 'derivar_consulta') {
    const resumen = String(args.resumen ?? '').trim();
    if (!resumen) return { ok: false, motivo: 'El resumen de la consulta está vacío.' };
    return { ok: true, operacion: { ...llamada, args: { resumen: resumen.slice(0, LARGO_MAX_CONSULTA) } } };
  }

  if (llamada.nombre === HERRAMIENTA_IMAGEN) {
    const productoId = String(args.productoId ?? '').trim();
    if (!productoId || productoId.length > MAX_LARGO_ID) {
      return { ok: false, motivo: 'Falta el id del producto: usá el que figura entre corchetes en la búsqueda.' };
    }
    const varianteId = typeof args.varianteId === 'string' ? args.varianteId.trim() : '';
    if (varianteId && !historial.variantesVistas.has(varianteId)) {
      return {
        ok: false,
        motivo: 'Esa versión no salió de ninguna búsqueda de esta charla: usá el id entre corchetes de la versión, o mandá sólo el producto.',
      };
    }
    const clave = claveDeFoto({ productoId, ...(varianteId ? { varianteId } : {}) });
    const fotos = historial.fotosEnElMensaje;
    if (fotos.has(clave)) {
      return { ok: false, motivo: 'Esa foto ya sale con esta respuesta: no la pidas de nuevo.' };
    }
    if (historial.fotosYaMandadas.has(clave)) {
      return { ok: false, motivo: 'Esa foto ya se la mandaste en esta charla: no se la mandes de nuevo, seguí la conversación.' };
    }
    if (fotos.size >= MAX_IMAGENES_POR_MENSAJE) {
      return {
        ok: false,
        motivo:
          `Ya van ${MAX_IMAGENES_POR_MENSAJE} fotos en esta respuesta, que es el máximo. Mandá esas y, si quiere ` +
          'ver otra, que te la pida en el próximo mensaje.',
      };
    }
    // Se anota acá y no al aprobar en el nodo: dos pedidos de foto en la misma respuesta también cuentan.
    fotos.add(clave);
    return { ok: true, operacion: { ...llamada, args: { productoId, ...(varianteId ? { varianteId } : {}) } } };
  }

  if (llamada.nombre === 'pedir_variante') {
    const varianteId = String(args.varianteId ?? '').trim();
    if (!varianteId || varianteId.length > MAX_LARGO_ID || !historial.variantesVistas.has(varianteId)) {
      return {
        ok: false,
        motivo:
          'Esa versión no salió de ninguna búsqueda de esta charla. Buscá el producto con buscar_productos y usá el ' +
          'id que figura entre corchetes como [variante …] en sus versiones con precio fijo.',
      };
    }
    const cantidad = Number(args.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD_VARIANTE_FIJA) {
      return { ok: false, motivo: `La cantidad tiene que ser un número entero entre 1 y ${MAX_CANTIDAD_VARIANTE_FIJA}.` };
    }
    const nombreCliente = String(args.nombreCliente ?? '').trim() || state.contexto.conversation.nombreCliente?.trim() || '';
    if (!nombreCliente) return { ok: false, motivo: 'Falta el nombre de la persona: preguntáselo antes de pedirlo.' };
    return { ok: true, operacion: { ...llamada, args: { varianteId, cantidad, nombreCliente } } };
  }

  if (llamada.nombre === 'registrar_solicitud') {
    const productoId = String(args.productoId ?? '').trim();
    if (!productoId || productoId.length > MAX_LARGO_ID || !historial.productosVistos.has(productoId)) {
      return {
        ok: false,
        motivo:
          'Ese producto no salió de ninguna búsqueda de esta charla. Buscalo con buscar_productos y usá el id que ' +
          'figura entre corchetes como [producto …].',
      };
    }
    const nombreCliente = String(args.nombreCliente ?? '').trim() || state.contexto.conversation.nombreCliente?.trim() || '';
    if (!nombreCliente) return { ok: false, motivo: 'Falta el nombre de la persona: preguntáselo antes de anotar la solicitud.' };
    const respuestas = ((args.respuestas ?? []) as Array<{ pregunta: string; respuesta: string }>)
      .map((dato) => ({ pregunta: String(dato.pregunta).trim(), respuesta: String(dato.respuesta).trim() }))
      .filter((dato) => dato.pregunta && dato.respuesta)
      .slice(0, MAX_RESPUESTAS)
      .map((dato) => ({ pregunta: dato.pregunta.slice(0, 120), respuesta: dato.respuesta.slice(0, LARGO_MAX_RESPUESTA) }));
    const resumen = String(args.resumen ?? '').trim().slice(0, LARGO_MAX_RESUMEN);
    const varianteBaseId = typeof args.varianteBaseId === 'string' ? args.varianteBaseId.trim() : '';
    const cambios = typeof args.cambios === 'string' ? args.cambios.trim().slice(0, LARGO_MAX_RESPUESTA) : '';
    if (varianteBaseId && !historial.variantesVistas.has(varianteBaseId)) {
      return {
        ok: false,
        motivo: 'Esa versión no salió de ninguna búsqueda de esta charla: usá el id entre corchetes de la versión, o no mandes ninguna.',
      };
    }
    if (varianteBaseId && !cambios) {
      return {
        ok: false,
        motivo:
          'Con varianteBaseId contá en cambios qué quiere distinto. Si la quiere tal cual, no es una solicitud: usá pedir_variante.',
      };
    }
    return {
      ok: true,
      operacion: {
        ...llamada,
        args: { productoId, nombreCliente, respuestas, resumen, ...(varianteBaseId ? { varianteBaseId, cambios } : {}) },
      },
    };
  }

  if (llamada.nombre === 'aceptar_presupuesto') {
    const pedidoId = String(args.pedidoId ?? '').trim();
    const pedido = state.contexto.pedidosAMedida.find((venta) => venta.id === pedidoId);
    if (!pedido) {
      return { ok: false, motivo: 'Ese pedido no es de esta conversación. Usá el id entre corchetes de "Pedidos a medida".' };
    }
    const estado = estadoVisible(pedido);
    if (!['cotizado', 'vencida', 'pendiente_pago'].includes(estado) || !pedido.presupuestos.some((p) => p.estado === 'enviado')) {
      return {
        ok: false,
        motivo: 'Ese pedido todavía no tiene un presupuesto para aceptar (o ya está cerrado). No hay nada que cobrar.',
      };
    }
    return { ok: true, operacion: { ...llamada, args: { pedidoId } } };
  }

  if (llamada.nombre === 'derivar_a_persona') {
    const pedidoId = typeof args.pedidoId === 'string' ? args.pedidoId.trim() : '';
    if (pedidoId && !state.contexto.pedidosAMedida.some((venta) => venta.id === pedidoId)) {
      return { ok: false, motivo: 'Ese pedido no es de esta conversación. Usá el id entre corchetes de "Pedidos a medida", o no mandes ninguno.' };
    }
    const detalle = String(args.detalle ?? '').trim().slice(0, LARGO_MAX_DETALLE_DERIVACION);
    if (!detalle) return { ok: false, motivo: 'Contá en una frase qué pasa, para que el equipo no le pregunte de nuevo.' };
    return { ok: true, operacion: { ...llamada, args: { ...(pedidoId ? { pedidoId } : {}), motivo: args.motivo, detalle } } };
  }

  if (llamada.nombre === 'crear_pedido') {
    const nombreCliente = String(args.nombreCliente ?? '').trim();
    if (!nombreCliente) {
      return { ok: false, motivo: 'Falta el nombre de la persona que compra: preguntáselo antes de crear el pedido.' };
    }
    const items = (args.items ?? []) as ItemPedido[];
    const problema = problemaDeForma(items);
    if (problema) return { ok: false, motivo: problema };
    // El id tiene que haber salido de una búsqueda de esta charla: uno recordado
    // de antes de la ventana o inventado es un producto que nadie le mostró.
    const noVistas = items.filter((item) => !historial.variantesVistas.has(item.varianteId));
    if (noVistas.length > 0) {
      return {
        ok: false,
        motivo:
          'Hay variantes que no salieron de ninguna búsqueda de esta charla. Buscá cada producto con ' +
          'buscar_productos y usá los ids de variante que te devuelva.',
      };
    }
    const datos = validarDatosPedido(leerConfigDatosCliente(state.contexto.agent), args);
    if (!datos.ok) return { ok: false, motivo: datos.motivo };
    return {
      ok: true,
      operacion: {
        ...llamada,
        // Lo que sigue al nodo catalogo es lo ya normalizado, no lo que mandó el modelo.
        args: { ...args, nombreCliente, items: agruparItems(items), entrega: datos.entrega, datosCliente: datos.datos },
      },
    };
  }

  return { ok: true, operacion: { ...llamada, args } };
}

export function crearNodoValidacionVentas() {
  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const ultimo = state.messages.at(-1);
    const llamadas = llamadasDe(
      ultimo && ultimo.getType() === 'ai' ? (ultimo as { tool_calls?: never[] }).tool_calls : undefined,
    );

    const historial = historialValidacion(state);
    const mensajes: ToolMessage[] = [];
    const pendientes: OperacionPendiente[] = [];
    for (const llamada of llamadas) {
      const veredicto = validarLlamadaVentas(state, llamada, historial);
      if (veredicto.ok) {
        // Varias búsquedas en una misma respuesta también cuentan para el tope.
        if (veredicto.operacion.nombre === 'buscar_productos') historial.busquedasEnElMensaje += 1;
        pendientes.push(veredicto.operacion);
      }
      else mensajes.push(new ToolMessage({ content: veredicto.motivo, tool_call_id: llamada.id, name: llamada.nombre }));
    }
    return { messages: mensajes, pendientes };
  };
}
