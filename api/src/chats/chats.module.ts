import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [WhatsappModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
