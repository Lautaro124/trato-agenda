import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Agent } from '../generated/prisma/client.js';
import { TIPOS_TITULAR, TIPOS_USO, type TipoTitular, type TipoUso } from './agent-catalog.js';

/** "HH:MM" en formato 24hs. */
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un tipo de turno del paso 3 de /contanos, con su duración por defecto. */
export class TipoEventoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nombre!: string;

  @IsInt()
  @Min(5)
  @Max(480)
  duracionMin!: number;
}

export class GenerateAgentDto {
  @IsIn(TIPOS_TITULAR)
  tipoTitular!: TipoTitular;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombreTitular!: string;

  @IsIn(TIPOS_USO)
  tipoUso!: TipoUso;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TipoEventoDto)
  tiposEvento!: TipoEventoDto[];

  @Matches(HORA_HHMM, { message: 'horaDesde tiene que ser "HH:MM" en formato 24hs.' })
  horaDesde!: string;

  @Matches(HORA_HHMM, { message: 'horaHasta tiene que ser "HH:MM" en formato 24hs.' })
  horaHasta!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  nombreBot!: string;
}

/** Vista pública del agente: nunca incluye el systemPrompt (config interna del bot). */
export type AgentPublico = Pick<
  Agent,
  | 'id'
  | 'tipoUso'
  | 'descripcion'
  | 'tipoTitular'
  | 'nombreTitular'
  | 'nombreBot'
  | 'horaDesde'
  | 'horaHasta'
  | 'allowedActions'
  | 'createdAt'
  | 'updatedAt'
> & { tiposEvento: TipoEvento[] };

export function aAgentPublico(agent: Agent): AgentPublico {
  return {
    id: agent.id,
    tipoUso: agent.tipoUso,
    descripcion: agent.descripcion,
    tipoTitular: agent.tipoTitular,
    nombreTitular: agent.nombreTitular,
    nombreBot: agent.nombreBot,
    horaDesde: agent.horaDesde,
    horaHasta: agent.horaHasta,
    tiposEvento: leerTiposEvento(agent),
    allowedActions: agent.allowedActions,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export type TipoEvento = { nombre: string; duracionMin: number };

/**
 * `Agent.tiposEvento` es una columna Json, así que Prisma la tipa como
 * `JsonValue`: hay que validar la forma antes de usarla en vez de castear.
 */
export function leerTiposEvento(agent: Pick<Agent, 'tiposEvento'>): TipoEvento[] {
  if (!Array.isArray(agent.tiposEvento)) return [];
  return agent.tiposEvento.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { nombre, duracionMin } = item as Record<string, unknown>;
    if (typeof nombre !== 'string' || typeof duracionMin !== 'number') return [];
    return [{ nombre, duracionMin }];
  });
}
