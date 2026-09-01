import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AgentsModule } from '../agents/agents.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';

@Module({
  // PassportModule: JwtAuthGuard del controller de prueba lo necesita en el árbol de DI.
  imports: [AgentsModule, CalendarModule, PassportModule.register({ session: false })],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
