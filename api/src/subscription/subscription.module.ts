import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MercadoPagoClient } from './mercadopago.client.js';
import { SubscriptionController } from './subscription.controller.js';
import { SubscriptionService } from './subscription.service.js';

@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, MercadoPagoClient],
  // MercadoPagoClient también lo usa el módulo comercio (links de pago de cada comercio).
  exports: [SubscriptionService, MercadoPagoClient],
})
export class SubscriptionModule {}
