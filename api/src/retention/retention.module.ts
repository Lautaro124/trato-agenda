import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [ConversationModule],
  providers: [RetentionService],
})
export class RetentionModule {}
