import { Module } from '@nestjs/common';
import { RegistroPerformanceService } from './registro.service.js';

/**
 * Módulo de performance de las cuentas de ventas (LAU-30). Por ahora sólo el
 * registro de etapas e interés por producto; no importa ningún otro módulo
 * del dominio, así comercio y conversación lo pueden usar sin ciclos.
 */
@Module({
  providers: [RegistroPerformanceService],
  exports: [RegistroPerformanceService],
})
export class PerformanceModule {}
