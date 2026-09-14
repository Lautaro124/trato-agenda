import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type Agent } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import type { GenerateAgentDto } from './agents.types.js';

function listarTiposEvento(dto: GenerateAgentDto): string {
  return dto.tiposEvento
    .map((tipo) => `${tipo.nombre.trim()} (${tipo.duracionMin} min)`)
    .join(', ');
}

/**
 * Arma la descripción que antes escribía el usuario a mano en el textarea de
 * /contanos, ahora a partir de los cinco datos del wizard. Queda persistida
 * en `Agent.descripcion` como campo informativo (no la lee ningún LLM: la
 * generación ya no depende de uno).
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

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { userId } });
  }

  /**
   * Arma la config del agente con la plantilla determinista
   * (agent-template.ts) y la persiste. Cero llamadas de red: no depende de
   * OpenRouter ni puede fallar por timeout de un LLM.
   */
  async generate(userId: string, dto: GenerateAgentDto): Promise<Agent> {
    if (dto.horaDesde >= dto.horaHasta) {
      // Comparar "HH:MM" como strings alcanza: mismo largo y campos de ancho fijo.
      throw new BadRequestException('La hora de fin tiene que ser posterior a la de inicio.');
    }

    const descripcion = construirDescripcion(dto);
    const config = construirConfiguracion(dto);

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
      // Ya no hay un modelo de OpenRouter que generó esto: lo distingue
      // `templateVersion`, no un valor ficticio acá.
      model: null,
      templateVersion: PLANTILLA_VERSION,
    };

    return this.prisma.agent.upsert({
      where: { userId },
      create: { userId, ...datos },
      update: datos,
    });
  }
}
