import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { OpenRouterClient } from './openrouter.client.js';

@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [AgentsController],
  providers: [AgentsService, OpenRouterClient],
  exports: [OpenRouterClient],
})
export class AgentsModule {}
