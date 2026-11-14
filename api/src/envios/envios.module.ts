import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EnviosController } from './envios.controller.js';
import { EnviosService } from './envios.service.js';

/**
 * Módulo de envíos (LAU-102): zonas, tarifas y el resolvedor. Exporta el
 * servicio para el grafo de ventas; el probador vive en ConversationModule
 * (probador-envios.controller.ts) porque necesita el grafo.
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [EnviosController],
  providers: [EnviosService],
  exports: [EnviosService],
})
export class EnviosModule {}
