import { Module } from '@nestjs/common';
import { ComercioModule } from '../comercio/comercio.module.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [WhatsappModule, ComercioModule, PerformanceModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
