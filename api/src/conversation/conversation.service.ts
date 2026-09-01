import { Injectable, Logger } from '@nestjs/common';
import { esAccionValida } from '../agents/agent-catalog.js';
import { OpenRouterClient, OpenRouterError, type ChatMessage, type ToolCall } from '../agents/openrouter.client.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../calendar/google-calendar.client.js';
import { Prisma, type Agent, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TOOLS } from './conversation-tools.js';

type AgentConUser = Agent & { user: User };

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const MAX_VUELTAS = 4;
/** Cuántos mensajes previos de la conversación se mandan como contexto. */
const VENTANA_HISTORIAL = 20;

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

    const toolDefs = agent.allowedActions.filter(esAccionValida).map((id) => TOOLS[id].definition);
    const systemMessage: ChatMessage = {
      role: 'system',
      content: `${agent.systemPrompt}\n\n${this.contextoFijo()}`,
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
          const resultado = await this.ejecutarTool(agent, conversation.id, call);
          await this.guardarMensaje(conversation.id, 'tool', {
            content: resultado,
            tool_call_id: call.id,
          });
        }
        continue;
      }

      const textoFinal = respuesta.content?.trim() || '¿Podés repetirlo? No llegué a entenderlo bien.';
      await this.guardarMensaje(conversation.id, 'assistant', { content: textoFinal });
      return textoFinal;
    }

    await this.guardarMensaje(conversation.id, 'assistant', { content: MENSAJE_LOOP_AGOTADO });
    return MENSAJE_LOOP_AGOTADO;
  }

  private async ejecutarTool(
    agent: AgentConUser,
    conversationId: string,
    call: ToolCall,
  ): Promise<string> {
    const nombre = call.function.name;
    if (!esAccionValida(nombre) || !agent.allowedActions.includes(nombre)) {
      return `La acción "${nombre}" no está habilitada para este agente.`;
    }

    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
    } catch {
      return 'Los parámetros de la acción no eran JSON válido. Reintentá con el formato correcto.';
    }

    try {
      return await TOOLS[nombre].execute(
        { user: agent.user, conversationId, calendarService: this.calendarService, prisma: this.prisma },
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

  private contextoFijo(): string {
    const ahora = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date());
    return `Contexto: estás hablando por WhatsApp con un cliente. Fecha y hora actual: ${ahora} (zona horaria ${TIMEZONE}). Usá siempre horarios en esa zona.`;
  }
}
