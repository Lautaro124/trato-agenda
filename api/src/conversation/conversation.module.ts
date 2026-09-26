import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AgentsModule } from '../agents/agents.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ComercioModule } from '../comercio/comercio.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { CheckpointerService } from './checkpointer.provider.js';
import { ConversationController } from './conversation.controller.js';
import { grafoProvider, grafoVentasProvider } from './conversation.providers.js';
import { ConversationService } from './conversation.service.js';
import { llmProvider } from './llm.provider.js';

@Module({
  // PassportModule: JwtAuthGuard del controller de prueba lo necesita en el árbol de DI.
  imports: [
    AgentsModule,
    CalendarModule,
    ComercioModule,
    SubscriptionModule,
    PassportModule.register({ session: false }),
  ],
  controllers: [ConversationController],
  providers: [ConversationService, CheckpointerService, llmProvider, grafoProvider, grafoVentasProvider],
  // CheckpointerService se exporta para que el borrado de cuenta pueda limpiar
  // los threads de LangGraph, que están fuera del cascade de Prisma.
  exports: [ConversationService, CheckpointerService],
})
export class ConversationModule {}
