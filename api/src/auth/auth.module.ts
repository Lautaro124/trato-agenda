import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AgentsModule } from '../agents/agents.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { CuentaService } from './cuenta.service.js';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DevAuthController } from './dev-auth.controller.js';
import { GoogleStrategy } from './google.strategy.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
    // register() es el que provee AuthModuleOptions, que los guards inyectan.
    PassportModule.register({ session: false }),
    // Para saber, en el callback, si el usuario ya tiene un Agent creado.
    AgentsModule,
    // Los tres son para la baja de cuenta (CuentaService): cerrar la sesión de
    // WhatsApp, cancelar el cobro y limpiar los threads del checkpointer.
    WhatsappModule,
    SubscriptionModule,
    ConversationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  // Primer candado del login con contraseña: en producción la ruta ni existe.
  controllers: [AuthController, ...(process.env.NODE_ENV === 'production' ? [] : [DevAuthController])],
  providers: [AuthService, CuentaService, GoogleStrategy, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
