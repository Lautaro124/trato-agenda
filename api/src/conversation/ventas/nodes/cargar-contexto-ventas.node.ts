/**
 * Primer nodo del grafo de ventas, todo código: carga el `Agent`, la
 * `Conversation` y un resumen del catálogo (categorías y cantidad, nunca los
 * productos), y arma el system prompt con las reglas que viven en código.
 */
import { Logger } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import type { DecisionesClient } from '../../../comercio/decisiones.client.js';
import { leerConfigDatosCliente, pideDatos, type EtapaDeCompra } from '../../../comercio/datos-cliente.rules.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { TIMEZONE } from '../../graph/agenda-rules.js';
import { pistaDeEmoji, reglasDeNaturalidad } from '../../graph/naturalidad.js';
import { bloqueDeSaludo, memoriaDelCliente, yaSePresento } from '../../graph/saludo.js';
import type { AgentConUser } from '../../graph/state.js';
import { prepararHistorial, VENTANA_POR_DEFECTO_MS } from '../../graph/ventana-historial.js';
import type { Agent, Conversation } from '../../../generated/prisma/client.js';
import { leerModalidad } from '../../../agents/modalidad-venta.js';
import type { PedidoAMedida } from '../../../comercio/pedidos-a-medida.service.js';
import {
  bloqueAtencionHumana,
  bloqueCatalogo,
  bloqueLocal,
  bloquePedidos,
  reglasDeAlcanceVentas,
  reglasDeEstiloVentas,
  reglasDeVenta,
} from '../reglas-ventas.js';
import { estadoDeLaCharla, etapaDesdeOrden, pedidoDeEtapa } from '../etapa-de-compra.js';
import type { ContextoVentas, EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

export type DepsContextoVentas = {
  prisma: PrismaService;
  /** Hasta cuánto para atrás ve el modelo el historial (HISTORIAL_IA_VENTANA). Por defecto, 14 días. */
  ventanaHistorialMs?: number;
  /** Jev (etapa-de-compra.ts). Sin él, o si falla, la regla de datos de siempre. */
  decisiones?: Pick<DecisionesClient, 'ordenar' | 'configurado'>;
};

const logger = new Logger('CargarContextoVentasNode');

/** Pedidos a medida que entran al contexto: los abiertos más los últimos cerrados. */
const PEDIDOS_A_MEDIDA_EN_CONTEXTO = 5;

/**
 * Lo que se habló mientras el chat lo atendió una persona, si se lo
 * devolvieron al asistente dentro de la ventana que ve: los mensajes de
 * entonces no están en el hilo de LangGraph (el asistente no corría).
 */
async function ultimaDevolucion(prisma: PrismaService, conversationId: string, desde: Date) {
  const venta = await prisma.venta.findFirst({
    where: { conversationId, devueltaAt: { not: null, gte: desde }, derivadaAt: { not: null } },
    orderBy: { devueltaAt: 'desc' },
    select: { derivadaAt: true, devueltaAt: true, notaDevolucion: true },
  });
  if (!venta?.derivadaAt || !venta.devueltaAt) return null;
  const mensajes = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ['user', 'assistant'] },
      createdAt: { gte: venta.derivadaAt, lte: venta.devueltaAt },
    },
    select: { role: true, content: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return { nota: venta.notaDevolucion, mensajes: mensajes.reverse() };
}

/**
 * Si el cliente ya eligió todo o sigue definiendo, según Jev. Sólo hace falta
 * cuando el comercio pide datos; null (sin Jev, primer mensaje o falla) deja
 * la regla de siempre. Un fallo va a logger.error, como en
 * SugerenciasService: que llegue a Sentry, nunca al cliente.
 */
async function etapaDeCompra(
  deps: DepsContextoVentas,
  agent: Agent,
  mensajes: BaseMessage[],
  conversation: Pick<Conversation, 'id' | 'nombreCliente'>,
): Promise<EtapaDeCompra | null> {
  if (!deps.decisiones?.configurado || !pideDatos(leerConfigDatosCliente(agent))) return null;
  const estado = estadoDeLaCharla(mensajes, conversation.nombreCliente);
  if (!estado) return null;
  try {
    return etapaDesdeOrden(await deps.decisiones.ordenar(pedidoDeEtapa(estado)));
  } catch (error) {
    logger.error(`Jev no pudo decidir la etapa de compra de la conversación ${conversation.id}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * En ventas sí hay a quién derivar: derivar_consulta le avisa al dueño, y a
 * pedido derivar_a_persona le pasa el chat a alguien del equipo.
 */
function naturalidadVentas(agent: Agent): string {
  const titular = agent.nombreTitular || 'este negocio';
  return reglasDeNaturalidad(
    titular,
    leerModalidad(agent) === 'pedido'
      ? 'que si prefiere hablar con alguien del equipo, se lo pasás con derivar_a_persona y sigue esa persona por este chat'
      : 'que si prefiere hablar con alguien del equipo, se lo pasás con derivar_consulta y le escribimos por este chat',
  );
}

export function contextoFijoVentas(
  agent: Agent,
  conversation: Pick<Conversation, 'remoteJid' | 'resumen' | 'nombreCliente'>,
  esPropietario: boolean,
  opciones: { mpConectado: boolean; yaSePresento: boolean; etapa?: EtapaDeCompra | null; pistaEmoji?: string },
  ahora: Date = new Date(),
): string {
  const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }).format(
    ahora,
  );
  const base = `Fecha y hora actual: ${fecha} (zona horaria ${TIMEZONE}).`;
  const presentacion = bloqueDeSaludo(agent, opciones.yaSePresento);
  const reglas =
    `${reglasDeVenta(agent, opciones.mpConectado, opciones.etapa ?? null)}\n\n${reglasDeAlcanceVentas(agent, esPropietario)}\n\n` +
    `${reglasDeEstiloVentas(agent)}${opciones.pistaEmoji ?? ''}\n\n${naturalidadVentas(agent)}${presentacion}`;

  if (esPropietario) {
    return (
      'Contexto: estás hablando con el dueño del negocio, de prueba por la web (no un cliente de WhatsApp). ' +
      'Atendelo como atenderías a un cliente para que vea cómo vendés. Si te pregunta por su negocio, tenés ' +
      'herramientas propias: consultar_stock para el stock real, listar_ventas para ver ventas y pedidos, y ' +
      `resumen_ventas para cuánto cobró y qué se vende más. ${base}\n\n${reglas}`
    );
  }

  const numero = conversation.remoteJid.split('@')[0];
  const memoria = memoriaDelCliente(conversation.resumen, opciones.yaSePresento);
  const nombre = conversation.nombreCliente
    ? `Ya sabés que se llama ${conversation.nombreCliente}: no se lo vuelvas a preguntar.`
    : '';
  return `Contexto: estás hablando por WhatsApp con un cliente (número ${numero}). ${memoria} ${nombre} ${base}\n\n${reglas}`;
}

export function crearNodoCargarContextoVentas(deps: DepsContextoVentas) {
  return async (state: EstadoVentasValue): Promise<EstadoVentasUpdate> => {
    const agent = (await deps.prisma.agent.findUnique({
      where: { userId: state.ownerUserId },
      include: { user: true },
    })) as AgentConUser | null;
    if (!agent) {
      throw new Error(`El usuario ${state.ownerUserId} no tiene un Agent configurado.`);
    }

    const historial = prepararHistorial(state.messages, new Date(), deps.ventanaHistorialMs ?? VENTANA_POR_DEFECTO_MS);

    const guardada = await deps.prisma.conversation.findUniqueOrThrow({
      where: { userId_remoteJid: { userId: state.ownerUserId, remoteJid: state.remoteJid } },
    });
    // Mismo criterio que la agenda: con historial fuera de la ventana, tampoco el resumen.
    const conversation = historial.hayHistorialOculto ? { ...guardada, resumen: null } : guardada;

    const aPedido = leerModalidad(agent) === 'pedido';
    const ventanaMs = deps.ventanaHistorialMs ?? VENTANA_POR_DEFECTO_MS;
    const [grupos, totalProductos, cuentaMp, pedidos, etapa, pedidosAMedida, devolucion] = await Promise.all([
      deps.prisma.producto.groupBy({
        by: ['categoria'],
        where: { userId: state.ownerUserId, activo: true, categoria: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { categoria: 'desc' } },
      }),
      deps.prisma.producto.count({ where: { userId: state.ownerUserId, activo: true } }),
      deps.prisma.cuentaMercadoPago.findUnique({ where: { userId: state.ownerUserId }, select: { id: true } }),
      deps.prisma.venta.findMany({
        where: { conversationId: conversation.id, tipo: 'stock' },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      etapaDeCompra(deps, agent, historial.visibles, conversation),
      aPedido
        ? (deps.prisma.venta.findMany({
            where: { conversationId: conversation.id, tipo: 'a_medida' },
            include: { items: true, presupuestos: { orderBy: { version: 'asc' } } },
            orderBy: { createdAt: 'desc' },
            take: PEDIDOS_A_MEDIDA_EN_CONTEXTO,
          }) as Promise<PedidoAMedida[]>)
        : Promise.resolve([] as PedidoAMedida[]),
      ultimaDevolucion(deps.prisma, conversation.id, new Date(Date.now() - ventanaMs)),
    ]);
    const mpConectado = cuentaMp !== null;
    const categorias = grupos.map((grupo) => ({ nombre: grupo.categoria as string, cantidad: grupo._count._all }));

    const atencionHumana = bloqueAtencionHumana(devolucion);
    const contexto: ContextoVentas = {
      agent,
      conversation,
      mpConectado,
      pedidosAMedida,
      bloqueSistema:
        `${agent.systemPrompt}\n\n${contextoFijoVentas(agent, conversation, state.esPropietario, {
          mpConectado,
          yaSePresento: yaSePresento(historial.visibles),
          etapa,
          pistaEmoji: pistaDeEmoji(historial.visibles),
        })}\n\n` +
        `${bloqueCatalogo(categorias, totalProductos)}\n\n${bloqueLocal(agent)}\n\n` +
        `${bloquePedidos(agent, mpConectado, pedidos, new Date(), pedidosAMedida)}` +
        (atencionHumana ? `\n\n${atencionHumana}` : ''),
    };

    return {
      ...(historial.marcado ? { messages: [historial.marcado] } : {}),
      contexto,
      pendientes: [],
      indiceDesde: Math.max(state.messages.length - 1, 0),
      inicioVisible: historial.inicio,
      correccion: '',
    };
  };
}
