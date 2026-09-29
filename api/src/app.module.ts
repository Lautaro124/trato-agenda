import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { ComercioModule } from './comercio/comercio.module.js';
import { validateEnv } from './config/env.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { NotificacionesModule } from './notificaciones/notificaciones.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { SubscriptionModule } from './subscription/subscription.module.js';
import { WhatsappModule } from './whatsapp/whatsapp.module.js';

@Module({
  imports: [
    // Primero, como pide Sentry: su interceptor nombra las transacciones por ruta.
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    AgentsModule,
    CalendarModule,
    ComercioModule,
    ConversationModule,
    NotificacionesModule,
    SubscriptionModule,
    WhatsappModule,
    RetentionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Reporta a Sentry lo que no es HttpException (los 4xx de negocio no) y
    // después responde igual que el filtro por defecto de Nest.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
