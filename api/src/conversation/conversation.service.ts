import { Injectable, Logger } from '@nestjs/common';
import { esAccionValida } from '../agents/agent-catalog.js';
import { leerTiposEvento } from '../agents/agents.types.js';
import { OpenRouterClient, OpenRouterError, type ChatMessage, type ToolCall } from '../agents/openrouter.client.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../calendar/google-calendar.client.js';
import { Prisma, type Agent, type Conversation, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  HERRAMIENTAS_PROPIETARIO,
  MARGEN_MINIMO_MIN,
  TOOLS,
  type Tool,
  type ToolPropietario,
} from './conversation-tools.js';

type AgentConUser = Agent & { user: User };

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const MAX_VUELTAS = 4;
/** Cuántos mensajes previos de la conversación se mandan como contexto. */
const VENTANA_HISTORIAL = 20;

/** Prefijo del JID sintético del banco de pruebas del Home (ver conversation.controller.ts). */
const WEB_TEST_JID_PREFIX = 'web-test:';

/** JID sintético para separar el historial del banco de pruebas del Home de las conversaciones reales de WhatsApp. */
export function jidDePrueba(userId: string): string {
  return `${WEB_TEST_JID_PREFIX}${userId}`;
}

/**
 * true si `remoteJid` es del banco de pruebas del Home (quien habla es el
 * propio dueño, no un cliente de WhatsApp) — el prefijo sólo lo arma
 * conversation.controller.ts a partir del usuario autenticado, así que un
 * remoteJid real de Baileys nunca puede tomar este valor.
 */
function esConversacionDePrueba(remoteJid: string): boolean {
  return remoteJid.startsWith(WEB_TEST_JID_PREFIX);
}

const MENSAJE_SIN_AGENTE = 'Este número todavía no está configurado. Avisale al dueño que complete el alta.';
const MENSAJE_DISCULPA_GENERICO = 'Perdón, tuve un problema para responderte. Probá de nuevo en un rato.';
const MENSAJE_LOOP_AGOTADO = 'Dejame confirmarlo con más calma y te aviso enseguida.';

type MensajeGuardado = { content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterClient,
    private readonly calendarService: CalendarService,
  ) {}

  async handleIncoming(ownerUserId: string, remoteJid: string, texto: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: { userId: ownerUserId },
      include: { user: true },
    });
    if (!agent) {
      return MENSAJE_SIN_AGENTE;
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { userId_remoteJid: { userId: ownerUserId, remoteJid } },
      create: { userId: ownerUserId, remoteJid },
      update: {},
    });

    await this.guardarMensaje(conversation.id, 'user', { content: texto });

    const esPropietario = esConversacionDePrueba(remoteJid);
    const toolDefs = [
      ...agent.allowedActions.filter(esAccionValida).map((id) => TOOLS[id].definition),
      ...(esPropietario ? Object.values(HERRAMIENTAS_PROPIETARIO).map((tool) => tool.definition) : []),
    ];
    const systemMessage: ChatMessage = {
      role: 'system',
      content: `${agent.systemPrompt}\n\n${this.contextoFijo(agent, conversation, esPropietario)}`,
    };

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const historial = await this.reconstruirHistorial(conversation.id);
      const messages: ChatMessage[] = [systemMessage, ...historial];

      let respuesta;
      try {
        respuesta = await this.openRouter.chat({ messages, tools: toolDefs.length > 0 ? toolDefs : undefined });
      } catch (error) {
        this.logger.error(
          `OpenRouter falló para conversación ${conversation.id}`,
          error as OpenRouterError,
        );
        await this.guardarMensaje(conversation.id, 'assistant', { content: MENSAJE_DISCULPA_GENERICO });
        return MENSAJE_DISCULPA_GENERICO;
      }

      if (respuesta.tool_calls && respuesta.tool_calls.length > 0) {
        await this.guardarMensaje(conversation.id, 'assistant', {
          content: respuesta.content,
          tool_calls: respuesta.tool_calls,
        });

        for (const call of respuesta.tool_calls) {
          const resultado = await this.ejecutarTool(agent, conversation.id, call, esPropietario);
          await this.guardarMensaje(conversation.id, 'tool', {
            content: resultado,
            tool_call_id: call.id,
          });
        }
        continue;
      }

      const textoFinal = respuesta.content?.trim() || '¿Podés repetirlo? No llegué a entenderlo bien.';
      await this.guardarMensaje(conversation.id, 'assistant', { content: textoFinal });
      if (!esPropietario) {
        await this.actualizarResumenCliente(conversation, texto, textoFinal);
      }
      return textoFinal;
    }

    await this.guardarMensaje(conversation.id, 'assistant', { content: MENSAJE_LOOP_AGOTADO });
    return MENSAJE_LOOP_AGOTADO;
  }

  private async ejecutarTool(
    agent: AgentConUser,
    conversationId: string,
    call: ToolCall,
    esPropietario: boolean,
  ): Promise<string> {
    const nombre = call.function.name;
    const tool: Tool | ToolPropietario | undefined =
      (esPropietario && HERRAMIENTAS_PROPIETARIO[nombre]) ||
      (esAccionValida(nombre) && agent.allowedActions.includes(nombre) ? TOOLS[nombre] : undefined);
    if (!tool) {
      return `La acción "${nombre}" no está habilitada para este agente.`;
    }

    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
    } catch {
      return 'Los parámetros de la acción no eran JSON válido. Reintentá con el formato correcto.';
    }

    try {
      return await tool.execute(
        {
          user: agent.user,
          agent,
          conversationId,
          calendarService: this.calendarService,
          prisma: this.prisma,
        },
        args,
      );
    } catch (error) {
      if (error instanceof CalendarUnavailableError) {
        this.logger.error(`Calendar no disponible en conversación ${conversationId}`, error);
        return 'No pude acceder a la agenda de Google Calendar ahora mismo. Avisale al dueño del negocio.';
      }
      this.logger.error(`Fallo ejecutando tool ${nombre} en conversación ${conversationId}`, error as Error);
      return `Error inesperado ejecutando "${nombre}": ${(error as Error).message}`;
    }
  }

  private async reconstruirHistorial(conversationId: string): Promise<ChatMessage[]> {
    const filasDesc = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: VENTANA_HISTORIAL,
    });
    const filas = filasDesc.reverse();

    return filas.map((fila) => {
      const guardado = fila.content as unknown as MensajeGuardado;
      if (fila.role === 'tool') {
        return { role: 'tool', content: guardado.content ?? '', tool_call_id: guardado.tool_call_id ?? '' };
      }
      if (fila.role === 'assistant') {
        return { role: 'assistant', content: guardado.content, tool_calls: guardado.tool_calls };
      }
      return { role: 'user', content: guardado.content ?? '' };
    });
  }

  private async guardarMensaje(
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    contenido: MensajeGuardado,
  ): Promise<void> {
    await this.prisma.message.create({
      data: { conversationId, role, content: contenido as unknown as Prisma.InputJsonValue },
    });
  }

  private contextoFijo(
    agent: Agent,
    conversation: Conversation,
    esPropietario: boolean,
  ): string {
    const ahora = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date());
    const base = `Fecha y hora actual: ${ahora} (zona horaria ${TIMEZONE}). Usá siempre horarios en esa zona.`;

    if (esPropietario) {
      return (
        `Contexto: estás hablando con el dueño del negocio, de prueba por la web (no un cliente de WhatsApp). ` +
        `Además de lo que ya podés hacer, tenés las herramientas listar_eventos_calendario, ` +
        `cancelar_evento_calendario y editar_evento_calendario para listar, cancelar o editar CUALQUIER evento ` +
        `de su Google Calendar, no sólo los turnos agendados en esta conversación — es él mismo, así que no hay ` +
        `problema de privacidad. Antes de cancelar o editar cualquier evento, SIEMPRE tenés que buscarlo primero ` +
        `con listar_eventos_calendario, mostrarle al dueño de qué evento se trata (fecha, horario y título) en ` +
        `un mensaje de texto, y esperar que confirme explícitamente. Recién ahí volvé a llamar la herramienta ` +
        `correspondiente con confirmado: true — nunca canceles ni edites sin ese paso previo. ${base}` +
        // Las mismas reglas que con un cliente: crear_turno las aplica igual acá.
        `\n\n${this.reglasDeAgenda(agent)}`
      );
    }

    const numero = conversation.remoteJid.split('@')[0];
    const memoria = conversation.resumen
      ? `Ya escribió antes. Resumen de lo que sabés de este cliente: ${conversation.resumen}`
      : 'Primera vez que te escribe este número.';
    const nombre = conversation.nombreCliente
      ? `Ya sabés que se llama ${conversation.nombreCliente}: no se lo vuelvas a preguntar, usá ese nombre al agendar.`
      : '';
    return (
      `Contexto: estás hablando por WhatsApp con un cliente (número ${numero}). ${memoria} ${nombre} ` +
      `${base}\n\n${this.reglasDeAgenda(agent)}`
    );
  }

  /**
   * Reglas no negociables, armadas desde la fila `Agent` y no desde el
   * systemPrompt generado: así sobreviven a cualquier regeneración del agente.
   * Los tools (conversation-tools.ts) las aplican igual aunque el modelo las
   * ignore — esto es para que no las intente violar y quede pidiendo perdón.
   */
  private reglasDeAgenda(agent: Agent): string {
    const tipos = leerTiposEvento(agent);
    const catalogo =
      tipos.length > 0
        ? tipos.map((tipo) => `${tipo.nombre} (${tipo.duracionMin} min)`).join(', ')
        : 'todavía no hay tipos de turno cargados';

    return (
      `Reglas de la agenda de ${agent.nombreTitular || 'este negocio'} (no las rompas):\n` +
      `- Te llamás ${agent.nombreBot} y sos el asistente de ${agent.nombreTitular || 'este negocio'}.\n` +
      `- Sólo se atiende de ${agent.horaDesde} a ${agent.horaHasta}. Nunca ofrezcas ni agendes nada fuera de esa franja.\n` +
      `- Tipos de turno y su duración: ${catalogo}. Calculá el fin sumándole la duración al inicio.\n` +
      `- Nunca superpongas turnos y dejá al menos ${MARGEN_MINIMO_MIN} minutos libres entre un turno y el siguiente.\n` +
      `- Antes de agendar, preguntá siempre a nombre de quién es el turno, salvo que ya te lo hayan dicho.`
    );
  }

  /**
   * Actualiza el resumen persistido del cliente para que el agente lo
   * "recuerde" más allá de VENTANA_HISTORIAL. Nunca debe romper la respuesta
   * al cliente: cualquier falla acá sólo se loguea.
   */
  private async actualizarResumenCliente(
    conversation: Conversation,
    mensajeCliente: string,
    respuestaAgente: string,
  ): Promise<void> {
    try {
      const resultado = await this.openRouter.chat({
        messages: [
          {
            role: 'system',
            content:
              'Mantenés un resumen breve (1-2 oraciones) de un cliente para un negocio, a partir de su ' +
              'resumen previo y el último intercambio. Respondé únicamente el texto del resumen actualizado, ' +
              'sin JSON ni markdown.',
          },
          {
            role: 'user',
            content:
              `Resumen previo (puede estar vacío): "${conversation.resumen ?? ''}"\n` +
              `Último mensaje del cliente: "${mensajeCliente}"\n` +
              `Última respuesta del agente: "${respuestaAgente}"`,
          },
        ],
      });

      const resumen = resultado.content?.trim();
      if (!resumen) return;

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { resumen: resumen.slice(0, 500) },
      });
    } catch (error) {
      this.logger.error(`No se pudo actualizar el resumen de la conversación ${conversation.id}`, error as Error);
    }
  }
}
