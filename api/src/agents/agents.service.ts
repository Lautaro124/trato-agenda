import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Agent } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import type { TipoTitular, TipoUso } from './agent-catalog.js';
import type { GenerateAgentDto, TipoEventoDto } from './agents.types.js';

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

  /**
   * Reemplaza sólo los tipos de turno y regenera lo que los repite (el system
   * prompt y la descripción) desde el resto de la fila, que no cambia. Los
   * turnos ya agendados guardan su propio inicio/fin: no se tocan.
   */
  async actualizarTiposEvento(userId: string, tipos: TipoEventoDto[]): Promise<Agent> {
    const agent = await this.prisma.agent.findUnique({ where: { userId } });
    if (!agent) throw new NotFoundException('Todavía no configuraste tu asistente.');

    const tiposEvento = tipos.map((tipo) => ({ ...tipo, nombre: tipo.nombre.trim() }));
    const nombres = new Set(tiposEvento.map((tipo) => tipo.nombre.toLowerCase()));
    if (nombres.size !== tiposEvento.length) {
      throw new BadRequestException('Hay dos reuniones con el mismo nombre.');
    }

    const dto: GenerateAgentDto = {
      // La fila guarda strings; sus valores salieron de este mismo catálogo.
      tipoTitular: agent.tipoTitular as TipoTitular,
      nombreTitular: agent.nombreTitular,
      tipoUso: agent.tipoUso as TipoUso,
      tiposEvento,
      horaDesde: agent.horaDesde,
      horaHasta: agent.horaHasta,
      nombreBot: agent.nombreBot,
    };
    const config = construirConfiguracion(dto);

    return this.prisma.agent.update({
      where: { userId },
      data: {
        tiposEvento: tiposEvento as unknown as Prisma.InputJsonValue,
        descripcion: construirDescripcion(dto),
        systemPrompt: config.systemPrompt,
        model: null,
        templateVersion: PLANTILLA_VERSION,
      },
    });
  }
}
