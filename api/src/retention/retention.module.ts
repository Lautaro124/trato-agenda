import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [ConversationModule, WhatsappModule],
  providers: [RetentionService],
})
export class RetentionModule {}
