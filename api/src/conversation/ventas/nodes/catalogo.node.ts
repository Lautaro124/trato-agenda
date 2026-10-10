/**
 * Único nodo del grafo de ventas que toca el catálogo: ejecuta lo que aprobó
 * la validación y devuelve un ToolMessage por cada llamada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { BusquedaService } from '../../../comercio/busqueda.service.js';
import type { HistoricoVentasService } from '../../../comercio/historico.service.js';
import type { ImagenesService } from '../../../comercio/imagenes.service.js';
import { RangoInvalidoError } from '../../../comercio/historico.rules.js';
import { leerDatosDeVenta, leerEntrega } from '../../../comercio/datos-cliente.rules.js';
import type { ItemPedido, MedioDePago } from '../../../comercio/ventas.rules.js';
import { telefonoDeJid } from '../../../comercio/ventas.rules.js';
import { PedidoRechazadoError, type VentasService } from '../../../comercio/ventas.service.js';
import type { SugerenciasService } from '../../../comercio/sugerencias.service.js';
import { avisoConsultaDerivada } from '../../../notificaciones/avisos.js';
import type { NotificacionesService } from '../../../notificaciones/notificaciones.service.js';
import type { OperacionPendiente } from '../../graph/state.js';
import type { ImagenAEnviar } from '../imagenes-de-la-vuelta.js';
import { hayDescuentosVigentes } from '../../../comercio/descuentos.rules.js';
import {
  conOfertaDeDescuentos,
  formatearCatalogo,
  formatearDescuentos,
  formatearListadoVentas,
  formatearPedidoCreado,
  formatearPedidos,
  formatearResultados,
  formatearResumenVentas,
  formatearStockDueno,
  yaSeHablaronDescuentos,
} from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

export type DepsCatalogo = {
  busqueda: Pick<BusquedaService, 'buscar'>;
  sugerencias: Pick<SugerenciasService, 'verCatalogo' | 'descuentosVigentes'>;
  ventas: Pick<VentasService, 'crearPedido' | 'pedidosDeConversacion' | 'cancelarUltimoPendiente'>;
  notificaciones: Pick<NotificacionesService, 'avisar' | 'consultaRecienteDe'>;
  historico: Pick<HistoricoVentasService, 'listar' | 'resumen'>;
  imagenes: Pick<ImagenesService, 'estadoDeFoto'>;
};

/** Lo que vuelve al modelo y, si es una foto aprobada, lo que la fachada le manda al cliente. */
type Resultado = string | { texto: string; imagen: ImagenAEnviar };

/** Sólo lo que escribió el cliente dentro de la ventana, en texto: es lo único que se le pasa a Jev. */
export function mensajesDelCliente(state: Pick<EstadoVentasValue, 'messages' | 'inicioVisible'>): string[] {
  return state.messages
    .slice(state.inicioVisible ?? 0)
    .filter((mensaje) => mensaje.getType() === 'human' && typeof mensaje.content === 'string')
    .map((mensaje) => mensaje.content as string);
}

/** Le suma a un resultado que muestra productos la oferta de los descuentos, si corresponde. */
type Ofrecer = (resultado: string) => Promise<string>;

export const MENSAJE_CATALOGO_CAIDO =
  'No pude consultar el catálogo en este momento. Pedile disculpas al cliente y decile que en un rato lo vuelva a intentar.';

export function crearNodoCatalogo(deps: DepsCatalogo) {
  const logger = new Logger('CatalogoNode');

  /**
   * Los descuentos se ofrecen una sola vez por charla, en el primer resultado
   * que muestra productos: si en lo que ve el modelo ya se ofrecieron o ya se
   * pasaron con ver_descuentos (también si se los pasa en esta misma
   * vuelta), no se repite. Si leerlos falla, la búsqueda sigue igual sin la
   * oferta.
   */
  function crearOferta(state: EstadoVentasValue): Ofrecer {
    let pendiente =
      !yaSeHablaronDescuentos(state.messages.slice(state.inicioVisible ?? 0)) &&
      !state.pendientes.some((operacion) => operacion.nombre === 'ver_descuentos');
    return async (resultado) => {
      if (!pendiente) return resultado;
      pendiente = false;
      try {
        const vigentes = await deps.sugerencias.descuentosVigentes(state.ownerUserId);
        return hayDescuentosVigentes(vigentes) ? conOfertaDeDescuentos(resultado) : resultado;
      } catch (error) {
        logger.error(
          `No se pudieron leer los descuentos para ofrecerlos en la conversación ${state.contexto.conversation.id}: ` +
            (error as Error).message,
        );
        return resultado;
      }
    };
  }

  type Args = OperacionPendiente['args'];

  async function crearPedido(state: EstadoVentasValue, args: Args): Promise<string> {
    const { agent, conversation, mpConectado } = state.contexto;
    const porDefecto: MedioDePago = mpConectado ? 'mercadopago' : 'manual';
    const medioPago: MedioDePago =
      args.medioPago === 'manual' || args.medioPago === 'mercadopago' ? args.medioPago : porDefecto;
    try {
      const venta = await deps.ventas.crearPedido({
        userId: state.ownerUserId,
        conversationId: conversation.id,
        remoteJid: state.remoteJid,
        nombreCliente: String(args.nombreCliente),
        items: args.items as ItemPedido[],
        medioPago,
        entrega: leerEntrega(args.entrega),
        datosCliente: leerDatosDeVenta(args.datosCliente),
        // El banco de pruebas del Home (quien habla es el dueño): pedido real, fuera del histórico.
        dePrueba: state.esPropietario,
      });
      return formatearPedidoCreado(agent, venta);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo crear el pedido: ${error.message}`;
      throw error;
    }
  }

  async function derivarConsulta(state: EstadoVentasValue, args: Args): Promise<string> {
    const { agent, conversation } = state.contexto;
    const titular = agent.nombreTitular || 'el negocio';
    const decile = `Decile al cliente que ${titular} le va a responder por este chat.`;
    if (await deps.notificaciones.consultaRecienteDe(state.ownerUserId, conversation.id)) {
      return `Ya le avisé a ${titular} hace un rato de una consulta de este cliente: no lo vuelvo a molestar. ${decile}`;
    }
    await deps.notificaciones.avisar(
      state.ownerUserId,
      avisoConsultaDerivada({
        conversationId: conversation.id,
        nombreCliente: conversation.nombreCliente,
        telefonoCliente: telefonoDeJid(state.remoteJid),
        resumen: String(args.resumen),
        dePrueba: state.esPropietario,
      }),
    );
    return `Listo, le avisé a ${titular}. ${decile}`;
  }

  /** listar_ventas y resumen_ventas (sólo el dueño). */
  async function historicoDeVentas(state: EstadoVentasValue, operacion: OperacionPendiente): Promise<string> {
    const { args } = operacion;
    const filtros = {
      desde: typeof args.desde === 'string' ? args.desde : undefined,
      hasta: typeof args.hasta === 'string' ? args.hasta : undefined,
    };
    try {
      if (operacion.nombre === 'listar_ventas') {
        const estado = typeof args.estado === 'string' ? (args.estado as never) : undefined;
        return formatearListadoVentas(await deps.historico.listar(state.ownerUserId, { ...filtros, estado }));
      }
      const [resumen, listado] = await Promise.all([
        deps.historico.resumen(state.ownerUserId, filtros),
        deps.historico.listar(state.ownerUserId, filtros),
      ]);
      return formatearResumenVentas(resumen, listado);
    } catch (error) {
      if (error instanceof RangoInvalidoError) return `Fechas inválidas: ${error.message}`;
      throw error;
    }
  }

  async function enviarImagen(state: EstadoVentasValue, args: Args): Promise<Resultado> {
    const productoId = String(args.productoId);
    const foto = await deps.imagenes.estadoDeFoto(state.ownerUserId, productoId);
    if (!foto) {
      return 'Ese producto no está en el catálogo. Usá el id entre corchetes de una búsqueda de esta charla.';
    }
    const nombre = JSON.stringify(foto.nombre);
    if (!foto.tieneFoto) {
      return `${nombre} no tiene foto. Decíselo al cliente y contale cómo es con lo que dice el catálogo.`;
    }
    return {
      texto:
        `Listo: la foto de ${nombre} le llega al cliente junto con tu respuesta. No la describas ni pegues ` +
        'links: seguí la charla (por ejemplo, preguntale si es lo que buscaba).',
      imagen: { productoId, nombre: foto.nombre },
    };
  }

  async function ejecutar(state: EstadoVentasValue, operacion: OperacionPendiente, ofrecer: Ofrecer): Promise<Resultado> {
    const { args } = operacion;
    switch (operacion.nombre) {
      case 'buscar_productos': {
        const consulta = String(args.consulta);
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        const productos = await deps.busqueda.buscar(state.ownerUserId, consulta, { categoria });
        const texto = formatearResultados(consulta, productos, state.contexto.agent);
        return productos.length > 0 ? ofrecer(texto) : texto;
      }
      case 'ver_catalogo': {
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        const catalogo = await deps.sugerencias.verCatalogo(state.ownerUserId, mensajesDelCliente(state), categoria);
        const texto = formatearCatalogo(catalogo, state.contexto.agent);
        return catalogo.tipo === 'vacio' ? texto : ofrecer(texto);
      }
      case 'ver_descuentos':
        return formatearDescuentos(await deps.sugerencias.descuentosVigentes(state.ownerUserId));
      case 'consultar_stock': {
        const consulta = String(args.consulta);
        return formatearStockDueno(consulta, await deps.busqueda.buscar(state.ownerUserId, consulta));
      }
      case 'crear_pedido':
        return crearPedido(state, args);
      case 'derivar_consulta':
        return derivarConsulta(state, args);
      case 'listar_ventas':
      case 'resumen_ventas':
        return historicoDeVentas(state, operacion);
      case 'enviar_imagen_producto':
        return enviarImagen(state, args);
      case 'consultar_pedido':
        return formatearPedidos(await deps.ventas.pedidosDeConversacion(state.contexto.conversation.id));
      case 'cancelar_pedido': {
        const cancelado = await deps.ventas.cancelarUltimoPendiente(state.contexto.conversation.id);
        return cancelado
          ? `Pedido cancelado y reserva liberada: ${formatearPedidos([cancelado])}`
          : 'Este cliente no tiene pedidos sin pagar para cancelar.';
      }
      default:
        return `La herramienta ${operacion.nombre} no existe.`;
    }
  }

  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const mensajes: ToolMessage[] = [];
    const ofrecer = crearOferta(state);
    // Una por una y en orden, a propósito: la oferta va en el primer resultado
    // que muestra productos, y los pedidos no tienen que correr en paralelo.
    for (const operacion of state.pendientes) {
      let resultado: Resultado;
      try {
        resultado = await ejecutar(state, operacion, ofrecer);
      } catch (error) {
        logger.error(`Falló ${operacion.nombre} en la conversación ${state.contexto.conversation.id}: ${(error as Error).message}`);
        resultado = MENSAJE_CATALOGO_CAIDO;
      }
      const [texto, artifact] = typeof resultado === 'string' ? [resultado, undefined] : [resultado.texto, resultado.imagen];
      // `artifact` no lo ve el modelo: lo levanta la fachada (imagenes-de-la-vuelta.ts).
      mensajes.push(new ToolMessage({ content: texto, tool_call_id: operacion.id, name: operacion.nombre, artifact }));
    }
    return { messages: mensajes, pendientes: [] };
  };
}
