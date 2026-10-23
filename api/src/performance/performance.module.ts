import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AgentsModule } from '../agents/agents.module.js';
import { LecturaPerformanceService } from './lectura.service.js';
import { PerformanceController } from './performance.controller.js';
import { PreguntasPerformanceService } from './preguntas.service.js';
import { RegistroPerformanceService } from './registro.service.js';

/**
 * Módulo de performance de las cuentas de ventas (LAU-30): el registro de
 * etapas, interés por producto y zona, la clasificación de las preguntas de
 * los clientes, y su lectura en `GET /performance`. Sólo importa
 * AgentsModule (por el cliente de OpenRouter), ningún otro módulo del
 * dominio, así comercio y conversación lo pueden usar sin ciclos.
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  // AgentsModule: el OpenRouterClient con el que se clasifican las preguntas (no importa nada del dominio).
  imports: [PassportModule.register({ session: false }), AgentsModule],
  controllers: [PerformanceController],
  providers: [RegistroPerformanceService, LecturaPerformanceService, PreguntasPerformanceService],
  exports: [RegistroPerformanceService],
})
export class PerformanceModule {}
