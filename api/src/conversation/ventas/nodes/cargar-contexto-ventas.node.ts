/**
 * Primer nodo del grafo de ventas, todo código: carga el `Agent`, la
 * `Conversation` y un resumen del catálogo (categorías y cantidad, nunca los
 * productos), y arma el system prompt con las reglas que viven en código.
 */
import { Logger } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { leerCondiciones } from '../../../comercio/condiciones-pago.rules.js';
import type { DecisionesClient } from '../../../comercio/decisiones.client.js';
import { leerConfigDatosCliente, pideDatos, type EtapaDeCompra } from '../../../comercio/datos-cliente.rules.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { TIMEZONE } from '../../graph/agenda-rules.js';
import { pistaDeEmoji, reglasDeNaturalidad } from '../../graph/naturalidad.js';
import { bloqueDeSaludo, memoriaDelCliente, yaSePresento } from '../../graph/saludo.js';
import type { AgentConUser } from '../../graph/state.js';
import { prepararHistorial, VENTANA_POR_DEFECTO_MS } from '../../graph/ventana-historial.js';
import type { Agent, Conversation } from '../../../generated/prisma/client.js';
import { bloqueAtencionHumana, ultimaAtencionHumana } from '../../graph/atencion-humana.js';
import {
  bloqueAnuncio,
  bloqueCatalogo,
  bloqueLocal,
  bloquePedidos,
  reglasDeAlcanceVentas,
  reglasDeEstiloVentas,
  reglasDeVenta,
} from '../reglas-ventas.js';
import { estadoDeLaCharla, etapaDesdeOrden, pedidoDeEtapa } from '../etapa-de-compra.js';
import type { ContextoVentas, EstadoVentasUpdate, EstadoVentasValue } from '../state.js';
import type { RegistroPerformanceService } from '../../../performance/registro.service.js';

export type DepsContextoVentas = {
  prisma: PrismaService;
  /** Hasta cuánto para atrás ve el modelo el historial (HISTORIAL_IA_VENTANA). Por defecto, 14 días. */
  ventanaHistorialMs?: number;
  /** Jev (etapa-de-compra.ts). Sin él, o si falla, la regla de datos de siempre. */
  decisiones?: Pick<DecisionesClient, 'ordenar' | 'configurado'>;
  /** Módulo de performance (LAU-30): actividad y etapa de Jev de cada chat. Sin él (evals), nada. */
  registro?: Pick<RegistroPerformanceService, 'tocarChat'>;
};

const logger = new Logger('CargarContextoVentasNode');

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

/** En ventas sí hay a quién derivar: derivar_consulta le avisa al dueño. */
function naturalidadVentas(agent: Agent): string {
  const titular = agent.nombreTitular || 'este negocio';
  return reglasDeNaturalidad(
    titular,
    'que si prefiere hablar con alguien del equipo, se lo pasás con derivar_consulta y le escribimos por este chat',
  );
}

export function contextoFijoVentas(
  agent: Agent,
  conversation: Pick<Conversation, 'remoteJid' | 'resumen' | 'nombreCliente'>,
  esPropietario: boolean,
  opciones: {
    mpConectado: boolean;
    yaSePresento: boolean;
    etapa?: EtapaDeCompra | null;
    pistaEmoji?: string;
    /** Módulo de envíos activo (LAU-102). */
    enviosActivo?: boolean;
  },
  ahora: Date = new Date(),
): string {
  const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }).format(
    ahora,
  );
  const base = `Fecha y hora actual: ${fecha} (zona horaria ${TIMEZONE}).`;
  const presentacion = bloqueDeSaludo(agent, opciones.yaSePresento);
  const reglas =
    `${reglasDeVenta(agent, opciones.mpConectado, opciones.etapa ?? null, opciones.enviosActivo === true)}\n\n` +
    `${reglasDeAlcanceVentas(agent, esPropietario, opciones.enviosActivo === true)}\n\n` +
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

    const ventanaMs = deps.ventanaHistorialMs ?? VENTANA_POR_DEFECTO_MS;
    const [grupos, totalProductos, cuentaMp, pedidos, etapa, devolucion, filaCondiciones, filaEnvios, anuncio] =
      await Promise.all([
      deps.prisma.producto.groupBy({
        by: ['categoria'],
        where: { userId: state.ownerUserId, activo: true, categoria: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { categoria: 'desc' } },
      }),
      deps.prisma.producto.count({ where: { userId: state.ownerUserId, activo: true } }),
      deps.prisma.cuentaMercadoPago.findUnique({ where: { userId: state.ownerUserId }, select: { id: true } }),
      deps.prisma.venta.findMany({
        where: { conversationId: conversation.id },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      etapaDeCompra(deps, agent, historial.visibles, conversation),
      ultimaAtencionHumana(deps.prisma, guardada, new Date(Date.now() - ventanaMs)),
      deps.prisma.condicionesPago.findUnique({ where: { userId: state.ownerUserId } }),
      deps.prisma.configuracionEnvios.findUnique({ where: { userId: state.ownerUserId }, select: { activo: true } }),
      // El anuncio desde el que llegó (LAU-103): queda en la base, así vale aunque pasen días.
      guardada.anuncioId
        ? deps.prisma.anuncio.findFirst({
            where: { id: guardada.anuncioId, userId: state.ownerUserId },
            select: {
              titulo: true,
              cuerpo: true,
              descripcionMiniatura: true,
              producto: { select: { id: true, nombre: true, activo: true } },
            },
          })
        : null,
    ]);
    // Sin el módulo (o sin envíos) el asistente sigue como siempre: coordina el envío por el chat.
    const enviosActivo = agent.haceEnvios && filaEnvios?.activo === true;
    const delAnuncio = bloqueAnuncio(anuncio);
    const mpConectado = cuentaMp !== null;
    const condicionesPago = leerCondiciones(filaCondiciones);
    // El banco de pruebas del Home no cuenta para el módulo de performance.
    if (!state.esPropietario) await deps.registro?.tocarChat(state.ownerUserId, conversation.id, { etapaJev: etapa });
    const categorias = grupos.map((grupo) => ({ nombre: grupo.categoria as string, cantidad: grupo._count._all }));

    const atencionHumana = bloqueAtencionHumana(devolucion);
    const contexto: ContextoVentas = {
      agent,
      conversation,
      mpConectado,
      condicionesPago,
      enviosActivo,
      bloqueSistema:
        `${agent.systemPrompt}\n\n${contextoFijoVentas(agent, conversation, state.esPropietario, {
          mpConectado,
          yaSePresento: yaSePresento(historial.visibles),
          etapa,
          pistaEmoji: pistaDeEmoji(historial.visibles),
          enviosActivo,
        })}\n\n` +
        `${bloqueCatalogo(categorias, totalProductos)}\n\n` +
        (delAnuncio ? `${delAnuncio}\n\n` : '') +
        `${bloqueLocal(agent)}\n\n` +
        `${bloquePedidos(agent, mpConectado, pedidos, new Date(), condicionesPago)}` +
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
