import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Agent } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_DISPONIBLES, ACCIONES_IDS, esAccionValida } from './agent-catalog.js';
import type { GenerateAgentDto } from './agents.types.js';
import { OpenRouterClient, type ChatMessage } from './openrouter.client.js';

type ConfigGenerada = { systemPrompt: string; allowedActions: string[] };

const CATALOGO_TEXTO = ACCIONES_IDS.map((id) => `- ${id}: ${ACCIONES_DISPONIBLES[id]}`).join('\n');

const META_SYSTEM_PROMPT = `Sos un generador de configuración para agentes de WhatsApp que agendan turnos.
Te dan un tipo de uso y una descripción de cómo un negocio/persona quiere agendar, y devolvés
la config de SU agente: el system prompt que va a usar ese agente para conversar con sus clientes
por WhatsApp, y qué acciones tiene habilitadas.

Acciones disponibles (elegí sólo de esta lista, nunca inventes otras):
${CATALOGO_TEXTO}

El "systemPrompt" que generes es el que va a usar el agente conversacional en runtime. Tiene que:
- Estar en español rioplatense (voseo), tono profesional y amable.
- Explicar el contexto del negocio/persona según la descripción dada.
- Instruir a preguntar por los datos que falten (día, horario, con quién) antes de agendar.
- Instruir a usar las herramientas disponibles para consultar disponibilidad antes de ofrecer un
  horario, y para agendar/cancelar/reprogramar sólo cuando el cliente confirmó.
- No prometer nada que las acciones habilitadas no puedan cumplir.

Respondé ÚNICAMENTE un JSON con esta forma exacta, sin texto extra:
{"systemPrompt": "...", "allowedActions": ["id1", "id2"]}`;

/** Se lanza cuando OpenRouter no devuelve una config con la forma esperada, ni tras el retry. */
export class GeneracionInvalidaError extends Error {}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async generate(userId: string, dto: GenerateAgentDto): Promise<Agent> {
    const modelo = this.config.get('OPENROUTER_MODEL', { infer: true });
    const config = await this.generarConReintento(dto);

    return this.prisma.agent.upsert({
      where: { userId },
      create: {
        userId,
        tipoUso: dto.tipoUso,
        descripcion: dto.descripcion,
        systemPrompt: config.systemPrompt,
        allowedActions: config.allowedActions,
        model: modelo,
      },
      update: {
        tipoUso: dto.tipoUso,
        descripcion: dto.descripcion,
        systemPrompt: config.systemPrompt,
        allowedActions: config.allowedActions,
        model: modelo,
      },
    });
  }

  private async generarConReintento(dto: GenerateAgentDto): Promise<ConfigGenerada> {
    const mensajeUsuario = `Tipo de uso: ${dto.tipoUso}\nDescripción: ${dto.descripcion}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: META_SYSTEM_PROMPT },
      { role: 'user', content: mensajeUsuario },
    ];

    try {
      return this.parsearConfig(await this.pedir(messages));
    } catch (primerError) {
      this.logger.warn(
        `Primer intento de generación inválido para tipoUso=${dto.tipoUso}: ${(primerError as Error).message}. Reintentando.`,
      );

      messages.push(
        {
          role: 'assistant',
          content: 'JSON inválido, lo corrijo.',
        },
        {
          role: 'user',
          content:
            'Tu respuesta anterior no era un JSON válido con esa forma exacta. Respondé de nuevo, ' +
            'sólo el JSON {"systemPrompt": "...", "allowedActions": ["..."]} , sin texto extra ni markdown, ' +
            `y con allowedActions siendo un subconjunto exacto de: ${ACCIONES_IDS.join(', ')}.`,
        },
      );

      try {
        return this.parsearConfig(await this.pedir(messages));
      } catch (segundoError) {
        throw new BadGatewayException(
          `No se pudo generar el agente: ${(segundoError as Error).message}`,
        );
      }
    }
  }

  private async pedir(messages: ChatMessage[]): Promise<string> {
    const respuesta = await this.openRouter.chat({ messages, jsonMode: true });
    if (!respuesta.content) {
      throw new GeneracionInvalidaError('OpenRouter devolvió una respuesta vacía.');
    }
    return respuesta.content;
  }

  private parsearConfig(contenido: string): ConfigGenerada {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contenido);
    } catch {
      throw new GeneracionInvalidaError('La respuesta no es JSON válido.');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new GeneracionInvalidaError('La respuesta no es un objeto JSON.');
    }

    const { systemPrompt, allowedActions } = parsed as Record<string, unknown>;

    if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      throw new GeneracionInvalidaError('Falta systemPrompt o está vacío.');
    }

    if (!Array.isArray(allowedActions) || !allowedActions.every((a) => typeof a === 'string')) {
      throw new GeneracionInvalidaError('allowedActions no es un array de strings.');
    }

    const invalidas = allowedActions.filter((a) => !esAccionValida(a));
    if (invalidas.length > 0) {
      throw new GeneracionInvalidaError(`allowedActions incluye ids fuera del catálogo: ${invalidas.join(', ')}`);
    }

    return { systemPrompt: systemPrompt.trim(), allowedActions };
  }
}
