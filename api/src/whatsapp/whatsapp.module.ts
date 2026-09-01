import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { WhatsappController } from './whatsapp.controller.js';
import { WhatsappService } from './whatsapp.service.js';

@Module({
  // JwtAuthGuard (AuthGuard('jwt')) necesita AuthModuleOptions de PassportModule
  // en el árbol de DI de este módulo, igual que en AuthModule.
  imports: [PassportModule.register({ session: false })],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
