/**
 * Primer nodo del grafo de ventas, todo código: carga el `Agent`, la
 * `Conversation` y un resumen del catálogo (categorías y cantidad, nunca los
 * productos), y arma el system prompt con las reglas que viven en código.
 */
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { TIMEZONE } from '../../graph/agenda-rules.js';
import type { AgentConUser } from '../../graph/state.js';
import type { Agent, Conversation } from '../../../generated/prisma/client.js';
import { bloqueCatalogo, reglasDeAlcanceVentas, reglasDeEstiloVentas, reglasDeVenta } from '../reglas-ventas.js';
import type { ContextoVentas, EstadoVentasUpdate, EstadoVentasValue } from '../state.js';

export type DepsContextoVentas = { prisma: PrismaService };

export function contextoFijoVentas(
  agent: Agent,
  conversation: Pick<Conversation, 'remoteJid' | 'resumen' | 'nombreCliente'>,
  esPropietario: boolean,
  ahora: Date = new Date(),
): string {
  const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }).format(
    ahora,
  );
  const base = `Fecha y hora actual: ${fecha} (zona horaria ${TIMEZONE}).`;
  const reglas = `${reglasDeVenta(agent)}\n\n${reglasDeAlcanceVentas(agent, esPropietario)}\n\n${reglasDeEstiloVentas()}`;

  if (esPropietario) {
    return (
      'Contexto: estás hablando con el dueño del negocio, de prueba por la web (no un cliente de WhatsApp). ' +
      'Atendelo como atenderías a un cliente para que vea cómo vendés, y si te pregunta por el stock real ' +
      `usá consultar_stock. ${base}\n\n${reglas}`
    );
  }

  const numero = conversation.remoteJid.split('@')[0];
  const memoria = conversation.resumen
    ? `Ya escribió antes. Resumen de lo que sabés de este cliente: ${conversation.resumen}`
    : 'Primera vez que te escribe este número.';
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

    const conversation = await deps.prisma.conversation.findUniqueOrThrow({
      where: { userId_remoteJid: { userId: state.ownerUserId, remoteJid: state.remoteJid } },
    });

    const [grupos, totalProductos] = await Promise.all([
      deps.prisma.producto.groupBy({
        by: ['categoria'],
        where: { userId: state.ownerUserId, activo: true, categoria: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { categoria: 'desc' } },
      }),
      deps.prisma.producto.count({ where: { userId: state.ownerUserId, activo: true } }),
    ]);
    const categorias = grupos.map((grupo) => ({ nombre: grupo.categoria as string, cantidad: grupo._count._all }));

    const contexto: ContextoVentas = {
      agent,
      conversation,
      bloqueSistema:
        `${agent.systemPrompt}\n\n${contextoFijoVentas(agent, conversation, state.esPropietario)}\n\n` +
        bloqueCatalogo(categorias, totalProductos),
    };

    return { contexto, pendientes: [], indiceDesde: Math.max(state.messages.length - 1, 0) };
  };
}
