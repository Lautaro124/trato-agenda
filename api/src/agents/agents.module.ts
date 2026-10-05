import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ActualizacionAgentesService } from './actualizacion-agentes.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { OpenRouterClient } from './openrouter.client.js';

@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [AgentsController],
  providers: [AgentsService, OpenRouterClient, ActualizacionAgentesService],
  exports: [OpenRouterClient, AgentsService],
})
export class AgentsModule {}
