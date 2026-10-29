import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { leerCondiciones, normalizarCondiciones, type CondicionesPago } from './condiciones-pago.rules.js';

export class CondicionesInvalidasError extends Error {}

/**
 * Cuotas y descuento en efectivo de un comercio (LAU-34): /cuenta en la web.
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

  async guardar(
    userId: string,
    entrada: { planesCuotas: unknown; descuentoEfectivoPorcentaje: unknown },
  ): Promise<CondicionesPago> {
    await this.exigirVentas(userId);
    const resultado = normalizarCondiciones(entrada);
    if ('error' in resultado) throw new CondicionesInvalidasError(resultado.error);
    const datos = {
      planesCuotas: resultado.condiciones.planesCuotas as unknown as Prisma.InputJsonValue,
      descuentoEfectivoPorcentaje: resultado.condiciones.descuentoEfectivoPorcentaje,
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
