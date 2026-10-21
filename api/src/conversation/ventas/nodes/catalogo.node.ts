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
import type { PedidosAMedidaService } from '../../../comercio/pedidos-a-medida.service.js';
import {
  MOTIVOS_DEL_ASISTENTE,
  leerSolicitudDeVenta,
  type MotivoDelAsistente,
} from '../../../comercio/pedido-a-medida.rules.js';
import { validarRespuestasSolicitud, type RespuestaSolicitud } from '../../../comercio/solicitud.rules.js';
import { avisoConsultaDerivada } from '../../../notificaciones/avisos.js';
import type { NotificacionesService } from '../../../notificaciones/notificaciones.service.js';
import type { RegistroPerformanceService } from '../../../performance/registro.service.js';
import type { OperacionPendiente } from '../../graph/state.js';
import { claveDeFoto, fotosMandadas, type ImagenAEnviar } from '../imagenes-de-la-vuelta.js';
import { mensajesVisibles } from '../../graph/ventana-historial.js';
import { hayDescuentosVigentes } from '../../../comercio/descuentos.rules.js';
import { MAX_PRODUCTOS_LISTADO, type ResultadoCatalogo } from '../../../comercio/sugerencias.rules.js';
import {
  conOfertaDeDescuentos,
  formatearCobroAMedida,
  formatearDerivacion,
  formatearSolicitudRegistrada,
  formatearCatalogo,
  formatearDescuentos,
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

export type DepsCatalogo = {
  busqueda: Pick<BusquedaService, 'buscar'>;
  sugerencias: Pick<SugerenciasService, 'verCatalogo' | 'descuentosVigentes'>;
  ventas: Pick<VentasService, 'crearPedido' | 'pedidosDeConversacion' | 'cancelarUltimoPendiente'>;
  notificaciones: Pick<NotificacionesService, 'avisar' | 'consultaRecienteDe'>;
  historico: Pick<HistoricoVentasService, 'listar' | 'resumen'>;
  imagenes: Pick<ImagenesService, 'estadoDeFoto'>;
  pedidos: Pick<
    PedidosAMedidaService,
    | 'productoParaSolicitud'
    | 'cotizacionPrevia'
    | 'registrarSolicitud'
    | 'cotizarSolicitud'
    | 'cobrar'
    | 'derivar'
    | 'varianteParaPedir'
    | 'pedirVariante'
  >;
  /** Módulo de performance (LAU-30): qué productos vio o pidió el chat y si se derivó. Sin él (evals), nada. */
  registro?: Pick<RegistroPerformanceService, 'registrarInteres' | 'registrarPedidoDeVariantes' | 'marcarDerivado'>;
};

/** Lo que vuelve al modelo y, si hay fotos aprobadas, lo que la fachada le manda al cliente. */
type Resultado = string | { texto: string; imagen: ImagenAEnviar | ImagenAEnviar[] };

/**
 * Las fotos que salen solas con el listado de ver_catalogo: sólo cuando es
 * la lista entera (hasta MAX_PRODUCTOS_LISTADO), de los productos que tienen
 * foto, cada una con su nombre y precio al pie. Las que ya le llegaron en la
 * charla no se repiten.
 */
export function fotosDelListado(catalogo: ResultadoCatalogo, yaMandadas: ReadonlySet<string>): ImagenAEnviar[] {
  if (catalogo.tipo !== 'listado' || catalogo.restantes > 0 || catalogo.productos.length > MAX_PRODUCTOS_LISTADO) return [];
  return catalogo.productos
    .filter((producto) => producto.tieneImagen && !yaMandadas.has(claveDeFoto({ productoId: producto.productoId })))
    .map((producto) => ({ productoId: producto.productoId, nombre: producto.nombre, leyenda: leyendaDeProducto(producto) }));
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
const CON_EFECTO = new Set([
  'crear_pedido',
  'cancelar_pedido',
  'derivar_consulta',
  'registrar_solicitud',
  'pedir_variante',
  'aceptar_presupuesto',
  'derivar_a_persona',
]);

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
  };

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
      if (!state.esPropietario) {
        const varianteIds = venta.items.flatMap((item) => (item.varianteId ? [item.varianteId] : []));
        await deps.registro?.registrarPedidoDeVariantes(state.ownerUserId, conversation.id, varianteIds);
      }
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
    if (!state.esPropietario) await deps.registro?.marcarDerivado(state.ownerUserId, conversation.id);
    return `Listo, le avisé a ${titular}. ${decile}`;
  }

  /**
   * Anota la solicitud a medida. Las respuestas se validan acá contra las
   * preguntas del producto (la validación no tiene la base): si falta una
   * necesaria, vuelve al modelo con lo que falta y no se anota nada.
   */
  async function registrarSolicitud(state: EstadoVentasValue, args: Args): Promise<string> {
    const producto = await deps.pedidos.productoParaSolicitud(state.ownerUserId, String(args.productoId));
    if (!producto) return 'Ese producto ya no está en el catálogo. Volvé a buscarlo.';
    if (!producto.solicitud) {
      return 'Ese producto es de stock, no a medida: no se cotiza. Si lo quiere, anotalo con crear_pedido.';
    }
    const respuestas = validarRespuestasSolicitud(producto.solicitud, args.respuestas);
    if (!respuestas.ok) {
      return `${respuestas.motivo} Preguntáselo al cliente (de a una o dos preguntas) antes de anotar la solicitud.`;
    }
    // Si la receta del producto necesita un dato que el cliente todavía no
    // dio, se le pregunta antes de anotar nada (y antes de molestar al dueño).
    const previa = await deps.pedidos.cotizacionPrevia(state.ownerUserId, producto.id, respuestas.respuestas);
    if (previa && !previa.resultado.ok && previa.resultado.faltan.length > 0) {
      return (
        `Para cotizarlo hace falta que el cliente conteste ${previa.resultado.faltan.map((t) => JSON.stringify(t)).join(', ')} ` +
        'con un número. Preguntáselo y volvé a llamar registrar_solicitud con todo.'
      );
    }
    // La versión de base tiene que ser de este mismo producto.
    const base =
      typeof args.varianteBaseId === 'string'
        ? await deps.pedidos.varianteParaPedir(state.ownerUserId, args.varianteBaseId)
        : null;
    if (typeof args.varianteBaseId === 'string' && base?.productoId !== producto.id) {
      return 'Esa versión no es de este producto. Usá el id entre corchetes de una de sus versiones con precio fijo, o no mandes ninguna.';
    }
    try {
      const resultado = await deps.pedidos.registrarSolicitud({
        userId: state.ownerUserId,
        conversationId: state.contexto.conversation.id,
        remoteJid: state.remoteJid,
        nombreCliente: String(args.nombreCliente),
        producto: { id: producto.id, nombre: producto.nombre },
        respuestas: respuestas.respuestas as RespuestaSolicitud[],
        resumen: String(args.resumen ?? ''),
        ...(base
          ? {
              variante: { id: base.varianteId, nombre: base.nombreVariante, precioCentavos: base.precioCentavos, cantidad: 1 },
              cambios: String(args.cambios ?? ''),
            }
          : {}),
        dePrueba: state.esPropietario,
      });
      await registrar.pedidos(state, [producto.id]);
      const cotizacion = await deps.pedidos.cotizarSolicitud(resultado, previa);
      return formatearSolicitudRegistrada(
        resultado,
        cotizacion.modo === 'automatica' ? { texto: cotizacion.texto } : null,
        cotizacion.modo === 'revision',
      );
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo anotar la solicitud: ${error.message}`;
      throw error;
    }
  }

  /** Una versión de precio fijo pedida tal cual: el pedido sale cotizado y con su cobro. */
  async function pedirVariante(state: EstadoVentasValue, args: Args): Promise<string> {
    try {
      const venta = await deps.pedidos.pedirVariante({
        userId: state.ownerUserId,
        conversationId: state.contexto.conversation.id,
        remoteJid: state.remoteJid,
        nombreCliente: String(args.nombreCliente),
        varianteId: String(args.varianteId),
        cantidad: Number(args.cantidad),
        entrega: leerEntrega(args.entrega),
        datosCliente: leerDatosDeVenta(args.datosCliente),
        dePrueba: state.esPropietario,
      });
      const productoId = leerSolicitudDeVenta(venta.solicitud)?.productoId;
      if (productoId) await registrar.pedidos(state, [productoId]);
      return formatearCobroAMedida(state.contexto.agent, venta, true);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo anotar el pedido: ${error.message}`;
      throw error;
    }
  }

  async function aceptarPresupuesto(state: EstadoVentasValue, args: Args): Promise<string> {
    try {
      const venta = await deps.pedidos.cobrar(state.ownerUserId, String(args.pedidoId), {
        autor: 'asistente',
        conversationId: state.contexto.conversation.id,
        entrega: leerEntrega(args.entrega),
        datosCliente: leerDatosDeVenta(args.datosCliente),
      });
      return formatearCobroAMedida(state.contexto.agent, venta);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo generar el cobro: ${error.message}`;
      throw error;
    }
  }

  async function derivarAPersona(state: EstadoVentasValue, args: Args): Promise<string> {
    const motivo = (MOTIVOS_DEL_ASISTENTE as readonly string[]).includes(String(args.motivo))
      ? (args.motivo as MotivoDelAsistente)
      : 'otro';
    try {
      const venta = await deps.pedidos.derivar({
        userId: state.ownerUserId,
        ventaId: typeof args.pedidoId === 'string' ? args.pedidoId : null,
        conversationId: state.contexto.conversation.id,
        remoteJid: state.remoteJid,
        nombreCliente: state.contexto.conversation.nombreCliente,
        motivo,
        detalle: String(args.detalle ?? ''),
        autor: 'asistente',
        dePrueba: state.esPropietario,
      });
      return formatearDerivacion(venta);
    } catch (error) {
      if (error instanceof PedidoRechazadoError) return `No se pudo pasar a una persona: ${error.message}`;
      throw error;
    }
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
    const varianteId = typeof args.varianteId === 'string' ? args.varianteId : undefined;
    const foto = await deps.imagenes.estadoDeFoto(state.ownerUserId, productoId, varianteId);
    if (!foto) {
      return varianteId
        ? 'Esa versión no es de ese producto (o ya no está). Usá los ids entre corchetes de una búsqueda de esta charla.'
        : 'Ese producto no está en el catálogo. Usá el id entre corchetes de una búsqueda de esta charla.';
    }
    const nombre = JSON.stringify(foto.nombre);
    if (!foto.tieneFoto) {
      return `${nombre} no tiene foto. Decíselo al cliente y contale cómo es con lo que dice el catálogo.`;
    }
    const imagen: ImagenAEnviar = { productoId, nombre: foto.nombre, ...(foto.deVariante && varianteId ? { varianteId } : {}) };
    // Una versión sin foto propia (sólo las hay a medida) manda la del producto: si esa ya le llegó, no se repite.
    if (
      !imagen.varianteId &&
      varianteId &&
      fotosMandadas(mensajesVisibles(state.messages, state.inicioVisible ?? 0)).has(claveDeFoto(imagen))
    ) {
      return `Esa versión no tiene foto propia y la de ${nombre} ya se la mandaste: no la repitas, seguí la charla.`;
    }
    await registrar.vistos(state, [productoId]);
    return {
      texto:
        `Listo: la foto de ${nombre} le llega al cliente junto con tu respuesta. No la describas ni pegues ` +
        'links: seguí la charla (por ejemplo, preguntale si es lo que buscaba).',
      imagen,
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
        const fotos = fotosDelListado(catalogo, fotosMandadas(mensajesVisibles(state.messages, state.inicioVisible ?? 0)));
        const texto = formatearCatalogo(catalogo, state.contexto.agent, new Set(fotos.map((foto) => foto.productoId)));
        if (catalogo.tipo === 'vacio') return texto;
        const conOferta = await ofrecer(texto);
        return fotos.length > 0 ? { texto: conOferta, imagen: fotos } : conOferta;
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
      case 'registrar_solicitud':
        return registrarSolicitud(state, args);
      case 'pedir_variante':
        return pedirVariante(state, args);
      case 'aceptar_presupuesto':
        return aceptarPresupuesto(state, args);
      case 'derivar_a_persona':
        return derivarAPersona(state, args);
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
      const [texto, artifact] = typeof resultado === 'string' ? [resultado, undefined] : [resultado.texto, resultado.imagen];
      // `artifact` no lo ve el modelo: lo levanta la fachada (imagenes-de-la-vuelta.ts).
      mensajes.push(new ToolMessage({ content: texto, tool_call_id: operacion.id, name: operacion.nombre, artifact }));
    }
    return { messages: mensajes, pendientes: [] };
  };
}
