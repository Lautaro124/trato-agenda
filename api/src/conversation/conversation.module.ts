import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ConversationService } from './conversation.service.js';

@Module({
  imports: [AgentsModule, CalendarModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
