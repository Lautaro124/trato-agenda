import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { AgentsService } from './agents.service.js';
import { aAgentPublico, GenerateAgentDto, type AgentPublico } from './agents.types.js';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /** Le permite al front saber si este usuario ya completó el onboarding. */
  @Get('me')
  async me(@CurrentUser() user: User): Promise<AgentPublico | null> {
    const agent = await this.agentsService.findByUserId(user.id);
    return agent ? aAgentPublico(agent) : null;
  }

  @Post('generate')
  async generate(@CurrentUser() user: User, @Body() dto: GenerateAgentDto): Promise<AgentPublico> {
    const agent = await this.agentsService.generate(user.id, dto);
    return aAgentPublico(agent);
  }
}
