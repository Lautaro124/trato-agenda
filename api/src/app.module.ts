import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { validateEnv } from './config/env.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { SubscriptionModule } from './subscription/subscription.module.js';
import { WhatsappModule } from './whatsapp/whatsapp.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    AgentsModule,
    CalendarModule,
    ConversationModule,
    SubscriptionModule,
    WhatsappModule,
    RetentionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
