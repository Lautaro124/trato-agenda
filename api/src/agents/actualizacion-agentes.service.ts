import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { tipoAsistenteDe } from './agent-catalog.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { configuracionVigente, estaAlDia } from './actualizacion-agentes.js';

export type ResultadoActualizacion = {
  regenerados: number;
  alDia: number;
  sinDatos: number;
  usuarios: { total: number; conAsistente: number; agenda: number; ventas: number; conWhatsapp: number };
};

/**
 * Al arrancar, lleva todos los agentes a la plantilla vigente
 * (actualizacion-agentes.ts) y deja en el log cuántos usuarios hay. Corre en
 * segundo plano: el arranque no lo espera, y si falla sólo queda el error.
 * Es idempotente: en el arranque siguiente están todos al día y no escribe nada.
 */
@Injectable()
export class ActualizacionAgentesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ActualizacionAgentesService.name);

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.actualizar().catch((error: unknown) => {
      this.logger.error(`No se pudieron actualizar los agentes: ${(error as Error).message}`);
    });
  }

  async actualizar(): Promise<ResultadoActualizacion> {
    const agentes = await this.prisma.agent.findMany();
    let regenerados = 0;
    let alDia = 0;
    let sinDatos = 0;
    for (const agent of agentes) {
      if (estaAlDia(agent)) {
        alDia += 1;
        continue;
      }
      const regeneracion = configuracionVigente(agent);
      if (!regeneracion.ok) {
        sinDatos += 1;
        // Sólo el id interno: los nombres son datos del dueño y esto va a los logs.
        this.logger.warn(`Agente ${agent.id} sin regenerar: ${regeneracion.motivo}.`);
        continue;
      }
      // Con updatedAt: si el dueño lo editó en el medio (/reuniones), gana su edición.
      const { count } = await this.prisma.agent.updateMany({
        where: { id: agent.id, updatedAt: agent.updatedAt },
        data: regeneracion.data,
      });
      if (count > 0) regenerados += 1;
    }

    const [total, conWhatsapp] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { phoneNumber: { not: null } } }),
    ]);
    const ventas = agentes.filter((agent) => tipoAsistenteDe(agent) === 'ventas').length;
    const resultado: ResultadoActualizacion = {
      regenerados,
      alDia,
      sinDatos,
      usuarios: { total, conAsistente: agentes.length, agenda: agentes.length - ventas, ventas, conWhatsapp },
    };
    this.logger.log(lineaDeLog(resultado));
    return resultado;
  }
}

/** Sólo números: esta línea queda en los logs de Railway. */
export function lineaDeLog({ regenerados, alDia, sinDatos, usuarios }: ResultadoActualizacion): string {
  return (
    `Agentes: ${regenerados} regenerados, ${alDia} al día, ${sinDatos} sin datos para regenerar. ` +
    `Usuarios: ${usuarios.total} (${usuarios.conAsistente} con asistente: ${usuarios.agenda} de agenda, ` +
    `${usuarios.ventas} de ventas; ${usuarios.conWhatsapp} con WhatsApp vinculado).`
  );
}
