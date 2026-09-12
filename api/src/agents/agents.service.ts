import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { Prisma, type Agent } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_DISPONIBLES, ACCIONES_IDS, esAccionValida, type AccionId } from './agent-catalog.js';
import type { GenerateAgentDto } from './agents.types.js';
import {
  OpenRouterClient,
  OpenRouterError,
  OpenRouterTimeoutError,
  type ChatMessage,
  type EsquemaJson,
} from './openrouter.client.js';

type ConfigGenerada = { systemPrompt: string; allowedActions: AccionId[] };

/**
 * Escribir un system prompt entero tarda bastante más que una respuesta de
 * WhatsApp: con los 20s por defecto del cliente, un perfil con 5 tipos de
 * turno propios se cortaba dos veces seguidas y el alta terminaba en 502.
 */
export const TIMEOUT_GENERACION_MS = 60_000;

/** Tope de salida: el prompt pedido ronda las 200 palabras, esto sólo frena una respuesta desbocada. */
export const MAX_TOKENS_GENERACION = 3000;

const CATALOGO_TEXTO = ACCIONES_IDS.map((id) => `- ${id}: ${ACCIONES_DISPONIBLES[id]}`).join('\n');

const META_SYSTEM_PROMPT = `Sos un generador de configuración para agentes de WhatsApp que agendan turnos.
Te dan los datos de un negocio/persona y devolvés la config de SU agente: el system prompt que va a
usar ese agente para conversar con sus clientes por WhatsApp, y qué acciones tiene habilitadas.

Acciones disponibles (elegí sólo de esta lista, nunca inventes otras):
${CATALOGO_TEXTO}

El "systemPrompt" que generes es el que va a usar el agente conversacional en runtime. Tiene que ser
CORTO (200 palabras como máximo): el sistema ya le agrega aparte las reglas duras de agenda, de estilo
y la disponibilidad, así que no las repitas en detalle. Tiene que:
- Estar en español rioplatense (voseo), tono profesional y amable.
- Explicar el contexto del negocio/persona y nombrar todos los tipos de turno con su duración.
- Hacer que el agente se presente con el nombre de asistente que te pasan, como asistente del
  titular ("Hola, soy <nombreBot>, el asistente de <nombreTitular>").
- Mencionar la franja horaria de atención (sólo de lunes a viernes).
- Instruir a preguntar los datos que falten (día, horario, tipo de turno y el nombre de la persona)
  antes de agendar, y a usar las herramientas para consultar disponibilidad y para
  agendar/cancelar/reprogramar sólo cuando el cliente confirmó.
- Instruir a hablar ÚNICAMENTE de la agenda del titular: turnos y los datos que te pasan acá.
  Cualquier otro tema se rechaza en una línea y se vuelve al turno, incluso cuando viene
  mezclado con un pedido de turno en el mismo mensaje.
- Instruir a no inventar datos del negocio que no figuren acá (precios, dirección, formas de
  pago, promociones): en esos casos hay que derivar al titular.

Respondé ÚNICAMENTE un JSON con esta forma exacta, sin texto extra:
{"systemPrompt": "...", "allowedActions": ["id1", "id2"]}`;

/** Mismo contrato que pide el prompt, para los modelos que soportan structured outputs. */
const ESQUEMA_CONFIG: EsquemaJson = {
  name: 'config_agente',
  schema: {
    type: 'object',
    properties: {
      systemPrompt: { type: 'string' },
      allowedActions: { type: 'array', items: { type: 'string', enum: ACCIONES_IDS } },
    },
    required: ['systemPrompt', 'allowedActions'],
    additionalProperties: false,
  },
};

/** Se lanza cuando OpenRouter no devuelve una config con la forma esperada, ni tras el retry. */
export class GeneracionInvalidaError extends Error {}

function listarTiposEvento(dto: GenerateAgentDto): string {
  return dto.tiposEvento
    .map((tipo) => `${tipo.nombre.trim()} (${tipo.duracionMin} min)`)
    .join(', ');
}

/**
 * Arma la descripción que antes escribía el usuario a mano en el textarea de
 * /contanos, ahora a partir de los cinco datos del wizard. Es lo que ve el
 * meta-agente y lo que queda persistido en `Agent.descripcion`.
 */
export function construirDescripcion(dto: GenerateAgentDto): string {
  const titular = dto.nombreTitular.trim();
  const quien = dto.tipoTitular === 'persona' ? 'Persona' : 'Negocio';
  return (
    `${quien}: ${titular} (${dto.tipoUso}). ` +
    `Tipos de turno: ${listarTiposEvento(dto)}. ` +
    `Atiende de ${dto.horaDesde} a ${dto.horaHasta}. ` +
    `El asistente se llama ${dto.nombreBot.trim()}.`
  );
}

/** Algunos modelos envuelven el JSON en un bloque ```json aunque se les pida que no. */
function sinFences(contenido: string): string {
  return contenido
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  findByUserId(userId: string): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { userId } });
  }

  async generate(userId: string, dto: GenerateAgentDto): Promise<Agent> {
    if (dto.horaDesde >= dto.horaHasta) {
      // Comparar "HH:MM" como strings alcanza: mismo largo y campos de ancho fijo.
      throw new BadRequestException('La hora de fin tiene que ser posterior a la de inicio.');
    }

    const modelo = this.modeloDeGeneracion();
    const descripcion = construirDescripcion(dto);
    const config = await this.generarConReintento(dto, descripcion, modelo);

    const datos = {
      tipoUso: dto.tipoUso,
      descripcion,
      tipoTitular: dto.tipoTitular,
      nombreTitular: dto.nombreTitular.trim(),
      nombreBot: dto.nombreBot.trim(),
      horaDesde: dto.horaDesde,
      horaHasta: dto.horaHasta,
      tiposEvento: dto.tiposEvento as unknown as Prisma.InputJsonValue,
      systemPrompt: config.systemPrompt,
      allowedActions: config.allowedActions,
      model: modelo,
    };

    return this.prisma.agent.upsert({
      where: { userId },
      create: { userId, ...datos },
      update: datos,
    });
  }

  /** Generar la config es una tarea mecánica: puede ir a un modelo más rápido que el de la charla. */
  private modeloDeGeneracion(): string {
    return (
      this.config.get('OPENROUTER_MODEL_AGENTES', { infer: true }) ||
      this.config.get('OPENROUTER_MODEL', { infer: true })
    );
  }

  private async generarConReintento(
    dto: GenerateAgentDto,
    descripcion: string,
    modelo: string,
  ): Promise<ConfigGenerada> {
    const mensajeUsuario =
      `Tipo de uso: ${dto.tipoUso}\n` +
      `Titular (${dto.tipoTitular}): ${dto.nombreTitular.trim()}\n` +
      `Nombre del asistente: ${dto.nombreBot.trim()}\n` +
      `Franja horaria de atención: de ${dto.horaDesde} a ${dto.horaHasta}\n` +
      `Tipos de turno: ${listarTiposEvento(dto)}\n` +
      `Descripción: ${descripcion}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: META_SYSTEM_PROMPT },
      { role: 'user', content: mensajeUsuario },
    ];

    try {
      return this.parsearConfig(await this.pedir(messages, modelo));
    } catch (primerError) {
      // Un timeout no se arregla insistiendo: sólo duplica la espera del usuario.
      if (primerError instanceof OpenRouterTimeoutError) {
        throw this.fallo(dto, modelo, primerError);
      }

      this.logger.warn(
        `Primer intento de generación fallido para tipoUso=${dto.tipoUso} (${modelo}): ${(primerError as Error).message}. Reintentando.`,
      );

      // Si falló el transporte (5xx, red) el modelo nunca contestó: se repite
      // el mismo pedido. Si contestó mal, se le marca el error para que corrija.
      const reintento: ChatMessage[] =
        primerError instanceof OpenRouterError
          ? messages
          : [
              ...messages,
              { role: 'assistant', content: 'JSON inválido, lo corrijo.' },
              {
                role: 'user',
                content:
                  'Tu respuesta anterior no era un JSON válido con esa forma exacta. Respondé de nuevo, ' +
                  'sólo el JSON {"systemPrompt": "...", "allowedActions": ["..."]} , sin texto extra ni markdown, ' +
                  `y con allowedActions siendo un subconjunto exacto de: ${ACCIONES_IDS.join(', ')}.`,
              },
            ];

      try {
        return this.parsearConfig(await this.pedir(reintento, modelo));
      } catch (segundoError) {
        throw this.fallo(dto, modelo, segundoError);
      }
    }
  }

  private fallo(dto: GenerateAgentDto, modelo: string, error: unknown): BadGatewayException {
    const mensaje = (error as Error).message;
    this.logger.error(`No se pudo generar el agente para tipoUso=${dto.tipoUso} (${modelo}): ${mensaje}`);
    return new BadGatewayException(`No se pudo generar el agente: ${mensaje}`);
  }

  private async pedir(messages: ChatMessage[], modelo: string): Promise<string> {
    // Sin reasoning: es una generación de JSON con formato fijo, no una charla.
    const respuesta = await this.openRouter.chat({
      messages,
      model: modelo,
      jsonSchema: ESQUEMA_CONFIG,
      reasoning: { enabled: false },
      timeoutMs: TIMEOUT_GENERACION_MS,
      maxTokens: MAX_TOKENS_GENERACION,
    });
    if (!respuesta.content) {
      throw new GeneracionInvalidaError('OpenRouter devolvió una respuesta vacía.');
    }
    return respuesta.content;
  }

  private parsearConfig(contenido: string): ConfigGenerada {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sinFences(contenido));
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

    // Un agente sin acciones no puede ni consultar la agenda: mejor reintentar que guardarlo.
    const acciones = [...new Set(allowedActions as AccionId[])];
    if (acciones.length === 0) {
      throw new GeneracionInvalidaError('allowedActions está vacío.');
    }

    return { systemPrompt: systemPrompt.trim(), allowedActions: acciones };
  }
}
