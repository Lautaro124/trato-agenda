import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { VentasService } from './ventas.service.js';

/** Cada cuánto se revisan los pagos pendientes: la reserva de un link dura 30 minutos. */
const CADA_MS = 5 * 60 * 1000;

/**
 * Barrido periódico de las ventas: marca como vencidas las reservas pasadas de
 * hora (sólo para mostrarlas bien) y concilia con Mercado Pago los pagos de
 * los links, por si algún webhook no llegó. `setInterval` y réplica única,
 * igual que RetentionService.
 */
@Injectable()
export class ConciliacionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConciliacionService.name);
  private timer?: NodeJS.Timeout;
  private corriendo = false;

  constructor(private readonly ventas: VentasService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.barrer(), CADA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async barrer(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      const cobradas = await this.ventas.conciliar();
      const vencidas = await this.ventas.vencerReservas();
      if (cobradas.length > 0 || vencidas > 0) {
        this.logger.log(`Ventas: ${cobradas.length} pagos conciliados, ${vencidas} reservas vencidas.`);
      }
    } catch (error) {
      this.logger.error(`Falló la conciliación de ventas: ${(error as Error).message}`);
    } finally {
      this.corriendo = false;
    }
  }
}
