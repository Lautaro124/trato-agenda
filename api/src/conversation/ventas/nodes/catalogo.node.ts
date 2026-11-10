/**
 * Único nodo del grafo de ventas que toca el catálogo: ejecuta lo que aprobó
 * la validación y devuelve un ToolMessage por cada llamada.
 */
import { ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { BusquedaService } from '../../../comercio/busqueda.service.js';
import type { HistoricoVentasService } from '../../../comercio/historico.service.js';
import { MAX_IMAGENES_POR_MENSAJE } from '../../../comercio/imagenes.rules.js';
import type { EstadoDeFoto, ImagenesService } from '../../../comercio/imagenes.service.js';
import { RangoInvalidoError } from '../../../comercio/historico.rules.js';
import { leerDatosDeVenta, leerEntrega } from '../../../comercio/datos-cliente.rules.js';
import type { RespuestaDelModelo } from '../../../comercio/preguntas-producto.rules.js';
import type { ItemPedido, MedioDePago } from '../../../comercio/ventas.rules.js';
import { telefonoDeJid } from '../../../comercio/ventas.rules.js';
import { PedidoRechazadoError, type VentasService } from '../../../comercio/ventas.service.js';
import type { SugerenciasService } from '../../../comercio/sugerencias.service.js';
import { avisoConsultaDerivada } from '../../../notificaciones/avisos.js';
import type { NotificacionesService } from '../../../notificaciones/notificaciones.service.js';
import type { RegistroPerformanceService } from '../../../performance/registro.service.js';
import type { Agent } from '../../../generated/prisma/client.js';
import { listadoConFotos } from '../../../agents/mensajes.rules.js';
import type { OperacionPendiente } from '../../graph/state.js';
import { claveDeFoto, fotosMandadas, type ImagenAEnviar } from '../imagenes-de-la-vuelta.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import { esFormaDePago } from '../../../comercio/condiciones-pago.rules.js';
import { hayDescuentosVigentes } from '../../../comercio/descuentos.rules.js';
import { MAX_PRODUCTOS_LISTADO, type ResultadoCatalogo } from '../../../comercio/sugerencias.rules.js';
import {
  conOfertaDeDescuentos,
  formatearCatalogo,
  formatearDescuentos,
  formatearFormasDePago,
  formatearListadoVentas,
  totalesDeVentas,
  formatearPedidoCreado,
  formatearPedidos,
  formatearResultados,
  formatearResumenVentas,
  formatearStockDueno,
  leyendaDeProducto,
  yaSeHablaronDescuentos,
} from '../reglas-ventas.js';
import type { EstadoVentasUpdate, EstadoVentasValue } from '../state.js';
import type { EnviosService } from '../../../envios/envios.service.js';
import { destinoEnTexto, formatearResolucionEnvio } from '../../../envios/envios.respuesta.js';
import { envioParaCobrar, type ConsultaEnvio, type Modalidad } from '../../../envios/envios.rules.js';
import { artifactDeEnvio } from '../envios-de-la-vuelta.js';

export type DepsCatalogo = {
  busqueda: Pick<BusquedaService, 'buscar'>;
  sugerencias: Pick<SugerenciasService, 'verCatalogo' | 'descuentosVigentes'>;
  ventas: Pick<VentasService, 'crearPedido' | 'pedidosDeConversacion' | 'cancelarUltimoPendiente' | 'cotizarFormasDePago'>;
  notificaciones: Pick<NotificacionesService, 'avisar' | 'consultaRecienteDe'>;
  historico: Pick<HistoricoVentasService, 'listar' | 'resumen'>;
  imagenes: Pick<ImagenesService, 'estadoDeFoto'>;
  /** Módulo de envíos (LAU-102): el resolvedor de tarifas. Sin él (evals), consultar_envio no se ofrece. */
  envios?: Pick<EnviosService, 'resolver'>;
  /** Módulo de performance (LAU-30): qué productos vio o pidió el chat y si se derivó. Sin él (evals), nada. */
  registro?: Pick<
    RegistroPerformanceService,
    'registrarInteres' | 'marcarDerivado' | 'registrarZonaDeDatos'
  >;
};

/** Lo que vuelve al modelo y, si hay fotos aprobadas, lo que la fachada le manda al cliente. */
type Resultado =
  | string
  | { texto: string; imagen: ImagenAEnviar | ImagenAEnviar[] }
  | { texto: string; artifact: ReturnType<typeof artifactDeEnvio> };

/**
 * Las fotos que salen solas con el listado de ver_catalogo, sea la lista
 * entera o los que eligió Jev de un catálogo grande: las de los productos que
 * tienen foto, hasta MAX_PRODUCTOS_LISTADO, cada una con su línea de la lista
 * al pie. Las que ya le llegaron en la charla no se repiten, y si el dueño
 * apagó las fotos de la lista no sale ninguna.
 */
export function fotosDelListado(
  catalogo: ResultadoCatalogo,
  yaMandadas: ReadonlySet<string>,
  agent?: Pick<Agent, 'mensajes'>,
): ImagenAEnviar[] {
  if (catalogo.tipo !== 'listado') return [];
  if (agent && !listadoConFotos(agent)) return [];
  return catalogo.productos
    .filter((producto) => producto.tieneImagen && !yaMandadas.has(claveDeFoto({ productoId: producto.productoId })))
    .slice(0, MAX_PRODUCTOS_LISTADO)
    .map((producto) => ({ productoId: producto.productoId, nombre: producto.nombre, leyenda: leyendaDeProducto(producto, agent) }));
}

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

/** Las herramientas que cambian algo afuera del hilo (cancelacion.ts). */
const CON_EFECTO = new Set(['crear_pedido', 'cancelar_pedido', 'derivar_consulta']);

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

  /**
   * Lo que va al módulo de performance. El banco de pruebas del Home no
   * cuenta. El registro nunca tira error (es de mejor esfuerzo).
   */
  const registrar = {
    vistos: (state: EstadoVentasValue, productoIds: string[]) =>
      state.esPropietario
        ? Promise.resolve()
        : deps.registro?.registrarInteres(state.ownerUserId, state.contexto.conversation.id, productoIds, 'vio'),
    pedidos: (state: EstadoVentasValue, productoIds: string[]) =>
      state.esPropietario
        ? Promise.resolve()
        : deps.registro?.registrarInteres(state.ownerUserId, state.contexto.conversation.id, productoIds, 'pidio'),
    /** La provincia que dio el cliente en el pedido (lo guardado, ya normalizado). */
    zona: (state: EstadoVentasValue, datosCliente: unknown) =>
      state.esPropietario
        ? Promise.resolve()
        : deps.registro?.registrarZonaDeDatos(state.ownerUserId, state.contexto.conversation.id, leerDatosDeVenta(datosCliente)),
  };

  async function crearPedido(state: EstadoVentasValue, args: Args): Promise<string> {
    const { agent, conversation, mpConectado } = state.contexto;
    const porDefecto: MedioDePago = mpConectado ? 'mercadopago' : 'manual';
    const medioPago: MedioDePago =
      args.medioPago === 'manual' || args.medioPago === 'mercadopago' ? args.medioPago : porDefecto;
    const cotizador = cotizadorDeEnvio(state, args.envio);
    try {
      const venta = await deps.ventas.crearPedido({
        userId: state.ownerUserId,
        conversationId: conversation.id,
        remoteJid: state.remoteJid,
        nombreCliente: String(args.nombreCliente),
        items: args.items as ItemPedido[],
        respuestas: Array.isArray(args.respuestas) ? (args.respuestas as RespuestaDelModelo[]) : [],
        medioPago,
        formaPago: esFormaDePago(args.formaPago) ? args.formaPago : null,
        cuotas: typeof args.cuotas === 'number' ? args.cuotas : null,
        entrega: leerEntrega(args.entrega),
        ...(cotizador ? { cotizarEnvio: cotizador } : {}),
        datosCliente: leerDatosDeVenta(args.datosCliente),
        // El banco de pruebas del Home (quien habla es el dueño): pedido real, fuera del histórico.
        dePrueba: state.esPropietario,
      });
      await registrar.pedidos(state, venta.items.flatMap((item) => (item.productoId ? [item.productoId] : [])));
      await registrar.zona(state, venta.datosCliente);
      return formatearPedidoCreado(agent, venta, state.contexto.condicionesPago);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo crear el pedido: ${error.message}`;
      throw error;
    }
  }

  /**
   * Con el envío que validó validacion-ventas: la tarifa se resuelve con las
   * reglas vigentes y el subtotal que reservó el pedido, nunca con un monto del
   * modelo. Sin tarifa fija, el pedido va sin envío y se coordina aparte.
   */
  function cotizadorDeEnvio(state: EstadoVentasValue, crudo: unknown) {
    const envios = deps.envios;
    if (!envios || typeof crudo !== 'object' || crudo === null) return null;
    const { modalidad, ...consulta } = crudo as ConsultaEnvio & { modalidad: Modalidad };
    return async (subtotalCentavos: number, moneda: string) => {
      const resolucion = await envios.resolver(state.ownerUserId, consulta, {
        subtotalCentavos,
        monedaSubtotal: moneda,
        registrar: false,
      });
      const centavos = envioParaCobrar(resolucion, modalidad, moneda);
      return centavos === null ? null : { modalidad, centavos, destino: destinoEnTexto(resolucion) };
    };
  }

  async function verFormasDePago(state: EstadoVentasValue, args: Args): Promise<string> {
    const { condicionesPago, mpConectado } = state.contexto;
    if (!Array.isArray(args.items)) {
      return formatearFormasDePago(condicionesPago, mpConectado, null);
    }
    try {
      const cotizacion = await deps.ventas.cotizarFormasDePago(state.ownerUserId, args.items as ItemPedido[]);
      return formatearFormasDePago(condicionesPago, mpConectado, cotizacion);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo cotizar: ${error.message}`;
      throw error;
    }
  }

  /**
   * Costo y plazo de envío con las reglas vigentes del comercio. El subtotal
   * para el envío gratis sale de la cotización del sistema (con las promos de
   * los productos, sin recargo de cuotas ni descuento en efectivo), nunca de
   * un número del modelo.
   */
  async function consultarEnvio(state: EstadoVentasValue, args: Args): Promise<Resultado> {
    if (!deps.envios) return 'Las tarifas de envío no están disponibles: el envío se coordina por este chat.';
    let subtotalCentavos: number | null = null;
    let monedaSubtotal: string | null = null;
    if (Array.isArray(args.items) && args.items.length > 0) {
      try {
        const cotizacion = await deps.ventas.cotizarFormasDePago(state.ownerUserId, args.items as ItemPedido[]);
        subtotalCentavos = cotizacion.contadoCentavos;
        monedaSubtotal = cotizacion.moneda;
      } catch (error) {
        if (!(error instanceof PedidoRechazadoError)) throw error;
      }
    }
    const consulta: ConsultaEnvio = {
      ...(typeof args.provincia === 'string' ? { provincia: args.provincia } : {}),
      ...(typeof args.localidad === 'string' ? { localidad: args.localidad } : {}),
      ...(typeof args.codigoPostal === 'string' ? { codigoPostal: args.codigoPostal } : {}),
    };
    const resolucion = await deps.envios.resolver(state.ownerUserId, consulta, {
      subtotalCentavos,
      monedaSubtotal,
      registrar: !state.esPropietario,
    });
    const pedido =
      subtotalCentavos !== null && monedaSubtotal !== null ? { subtotalCentavos, moneda: monedaSubtotal } : null;
    return { texto: formatearResolucionEnvio(resolucion, pedido), artifact: artifactDeEnvio(resolucion) };
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
    if (!state.esPropietario) await deps.registro?.marcarDerivado(state.ownerUserId, conversation.id);
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
      // Los totales van por moneda: nunca se suman pesos con dólares.
      if (operacion.nombre === 'listar_ventas') {
        const estado = typeof args.estado === 'string' ? (args.estado as never) : undefined;
        const listado = await deps.historico.listar(state.ownerUserId, { ...filtros, estado });
        if (!listado.monedas.includes('USD')) return formatearListadoVentas(listado);
        const enDolares = await deps.historico.listar(state.ownerUserId, { ...filtros, estado, moneda: 'USD' });
        return `${formatearListadoVentas(listado)}\n${totalesDeVentas(enDolares)}`;
      }
      const [resumen, listado] = await Promise.all([
        deps.historico.resumen(state.ownerUserId, filtros),
        deps.historico.listar(state.ownerUserId, filtros),
      ]);
      if (!listado.monedas.includes('USD')) return formatearResumenVentas(resumen, listado);
      const [resumenUsd, listadoUsd] = await Promise.all([
        deps.historico.resumen(state.ownerUserId, { ...filtros, moneda: 'USD' }),
        deps.historico.listar(state.ownerUserId, { ...filtros, moneda: 'USD' }),
      ]);
      return `${formatearResumenVentas(resumen, listado)}\nEn dólares: ${formatearResumenVentas(resumenUsd, listadoUsd)}`;
    } catch (error) {
      if (error instanceof RangoInvalidoError) return `Fechas inválidas: ${error.message}`;
      throw error;
    }
  }

  async function enviarImagen(state: EstadoVentasValue, args: Args): Promise<Resultado> {
    const productoId = String(args.productoId);
    const foto = await deps.imagenes.estadoDeFoto(state.ownerUserId, productoId);
    if (!foto) return 'Ese producto no está en el catálogo. Usá el id entre corchetes de una búsqueda de esta charla.';
    const nombre = JSON.stringify(foto.nombre);
    if (!foto.tieneFoto) {
      return `${nombre} no tiene foto. Decíselo al cliente y contale cómo es con lo que dice el catálogo.`;
    }
    if (args.detalles === true) return enviarDetalles(state, productoId, foto);
    const imagen: ImagenAEnviar = { productoId, nombre: foto.nombre };
    await registrar.vistos(state, [productoId]);
    return {
      texto:
        `Listo: la foto de ${nombre} le llega al cliente junto con tu respuesta. No la describas ni pegues ` +
        'links: seguí la charla (por ejemplo, preguntale si es lo que buscaba).',
      imagen,
    };
  }

  /** Las fotos de detalle que todavía no le llegaron: la principal no, que sale al mostrar el producto. */
  async function enviarDetalles(state: EstadoVentasValue, productoId: string, foto: EstadoDeFoto): Promise<Resultado> {
    const nombre = JSON.stringify(foto.nombre);
    if (foto.detalles.length === 0) {
      return `${nombre} no tiene más fotos que la principal. Contale los detalles con lo que dice el catálogo.`;
    }
    const yaMandadas = fotosMandadas(mensajesVisibles(state.messages, state.inicioVisible ?? 0));
    const imagenes: ImagenAEnviar[] = foto.detalles
      .map((imagenId) => ({ productoId, imagenId, nombre: foto.nombre }))
      .filter((imagen) => !yaMandadas.has(claveDeFoto(imagen)))
      .slice(0, MAX_IMAGENES_POR_MENSAJE);
    if (imagenes.length === 0) {
      return `Ya le mandaste todas las fotos de ${nombre} en esta charla: no se las mandes de nuevo, seguí la conversación.`;
    }
    await registrar.vistos(state, [productoId]);
    return {
      texto:
        `Listo: le llegan ${imagenes.length} fotos más de ${nombre} junto con tu respuesta. No las describas ni ` +
        'pegues links: seguí la charla (por ejemplo, preguntale si tiene alguna duda).',
      imagen: imagenes,
    };
  }

  async function ejecutar(state: EstadoVentasValue, operacion: OperacionPendiente, ofrecer: Ofrecer): Promise<Resultado> {
    const { args } = operacion;
    switch (operacion.nombre) {
      case 'buscar_productos': {
        const consulta = String(args.consulta);
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        const productos = await deps.busqueda.buscar(state.ownerUserId, consulta, { categoria });
        await registrar.vistos(state, productos.map((producto) => producto.productoId));
        const texto = formatearResultados(consulta, productos, state.contexto.agent);
        return productos.length > 0 ? ofrecer(texto) : texto;
      }
      case 'ver_catalogo': {
        const categoria = typeof args.categoria === 'string' ? args.categoria : undefined;
        const catalogo = await deps.sugerencias.verCatalogo(state.ownerUserId, mensajesDelCliente(state), categoria);
        if (catalogo.tipo === 'listado') await registrar.vistos(state, catalogo.productos.map((producto) => producto.productoId));
        const fotos = fotosDelListado(
          catalogo,
          fotosMandadas(mensajesVisibles(state.messages, state.inicioVisible ?? 0)),
          state.contexto.agent,
        );
        const texto = formatearCatalogo(catalogo, state.contexto.agent, new Set(fotos.map((foto) => foto.productoId)));
        if (catalogo.tipo === 'vacio') return texto;
        const conOferta = await ofrecer(texto);
        return fotos.length > 0 ? { texto: conOferta, imagen: fotos } : conOferta;
      }
      case 'ver_descuentos':
        return formatearDescuentos(await deps.sugerencias.descuentosVigentes(state.ownerUserId));
      case 'ver_formas_de_pago':
        return verFormasDePago(state, args);
      case 'consultar_stock': {
        const consulta = String(args.consulta);
        return formatearStockDueno(consulta, await deps.busqueda.buscar(state.ownerUserId, consulta));
      }
      case 'crear_pedido':
        return crearPedido(state, args);
      case 'derivar_consulta':
        return derivarConsulta(state, args);
      case 'consultar_envio':
        return consultarEnvio(state, args);
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
    // Un pedido o un aviso al dueño no se deshacen: desde acá la vuelta ya no se descarta.
    if (state.pendientes.some((operacion) => CON_EFECTO.has(operacion.nombre))) state.cancelacion?.comprometer();
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
      const [texto, artifact] =
        typeof resultado === 'string'
          ? [resultado, undefined]
          : 'imagen' in resultado
            ? [resultado.texto, resultado.imagen]
            : [resultado.texto, resultado.artifact];
      // `artifact` no lo ve el modelo: lo levanta la fachada (imagenes-de-la-vuelta.ts).
      mensajes.push(new ToolMessage({ content: texto, tool_call_id: operacion.id, name: operacion.nombre, artifact }));
    }
    return { messages: mensajes, pendientes: [] };
  };
}
