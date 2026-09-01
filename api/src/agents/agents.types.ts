import { IsIn, IsString, MinLength } from 'class-validator';
import type { Agent } from '../generated/prisma/client.js';
import { TIPOS_USO, type TipoUso } from './agent-catalog.js';

export class GenerateAgentDto {
  @IsIn(TIPOS_USO)
  tipoUso!: TipoUso;

  @IsString()
  @MinLength(10)
  descripcion!: string;
}

/** Vista pública del agente: nunca incluye el systemPrompt (config interna del bot). */
export type AgentPublico = Pick<
  Agent,
  'id' | 'tipoUso' | 'descripcion' | 'allowedActions' | 'createdAt' | 'updatedAt'
>;

export function aAgentPublico(agent: Agent): AgentPublico {
  return {
    id: agent.id,
    tipoUso: agent.tipoUso,
    descripcion: agent.descripcion,
    allowedActions: agent.allowedActions,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
