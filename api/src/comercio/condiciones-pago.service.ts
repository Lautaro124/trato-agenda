import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  filaDeCobroManual,
  leerCondiciones,
  normalizarCondiciones,
  type CondicionesPago,
} from './condiciones-pago.rules.js';

export class CondicionesInvalidasError extends Error {}

/**
 * Cuotas, descuento en efectivo y cobro sin link de un comercio (LAU-34):
 * /cuenta en la web.
 * Sólo para cuentas de ventas (409 si no); todo por `userId`.
 */
@Injectable()
export class CondicionesPagoService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(userId: string): Promise<CondicionesPago> {
    await this.exigirVentas(userId);
    return this.condiciones(userId);
  }

  /** Las guardadas, para el asistente. */
  async condiciones(userId: string): Promise<CondicionesPago> {
    return leerCondiciones(await this.prisma.condicionesPago.findUnique({ where: { userId } }));
  }

  /** Sin `cobroManual` en la entrada (una pantalla vieja) se deja el que estaba. */
  async guardar(
    userId: string,
    entrada: { planesCuotas: unknown; descuentoEfectivoPorcentaje: unknown; cobroManual?: unknown },
  ): Promise<CondicionesPago> {
    await this.exigirVentas(userId);
    const cobroManual =
      entrada.cobroManual === undefined ? (await this.condiciones(userId)).cobroManual : entrada.cobroManual;
    const resultado = normalizarCondiciones({ ...entrada, cobroManual });
    if ('error' in resultado) throw new CondicionesInvalidasError(resultado.error);
    const datos = {
      planesCuotas: resultado.condiciones.planesCuotas as unknown as Prisma.InputJsonValue,
      descuentoEfectivoPorcentaje: resultado.condiciones.descuentoEfectivoPorcentaje,
      ...filaDeCobroManual(resultado.condiciones.cobroManual),
    };
    await this.prisma.condicionesPago.upsert({ where: { userId }, create: { userId, ...datos }, update: datos });
    return resultado.condiciones;
  }

  private async exigirVentas(userId: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { tipoAsistente: true } });
    if (!agent || agent.tipoAsistente !== 'ventas') {
      throw new ConflictException('Las formas de pago son para las cuentas que venden.');
    }
  }
}
