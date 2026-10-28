import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  datosDelHorario,
  dentroDelHorario,
  GRACIA_EN_CURSO_MS,
  leerHorarioAtencion,
  normalizarHorarioAtencion,
  resumenHorarioAtencion,
  ZONA_POR_DEFECTO,
  type HorarioAtencion,
  type HorarioAtencionEntrada,
} from './horario-atencion.rules.js';
import type { HorarioAtencionPublico } from './horario-atencion.types.js';

const COLUMNAS = { horarioAtencionActivo: true, horarioAtencion: true, zonaHoraria: true } as const;

function aPublico(horario: HorarioAtencion): HorarioAtencionPublico {
  return { ...horario, resumen: resumenHorarioAtencion(horario) };
}

@Injectable()
export class HorarioAtencionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sin usuario (se borró la cuenta en el medio) atiende siempre, igual que un dato roto. */
  async leer(userId: string): Promise<HorarioAtencion> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: COLUMNAS });
    return user ? leerHorarioAtencion(user) : { activo: false, franjas: [], zona: ZONA_POR_DEFECTO };
  }

  async publico(userId: string): Promise<HorarioAtencionPublico> {
    return aPublico(await this.leer(userId));
  }

  async actualizar(userId: string, entrada: HorarioAtencionEntrada): Promise<HorarioAtencionPublico> {
    const resultado = normalizarHorarioAtencion(entrada);
    if ('error' in resultado) throw new BadRequestException(resultado.error);
    await this.prisma.user.update({ where: { id: userId }, data: datosDelHorario(resultado.horario) });
    return aPublico(resultado.horario);
  }

  /**
   * Si el asistente puede contestarle a este chat ahora. Dentro del horario (o
   * sin restricción), sí. Fuera, sólo si la conversación está en curso: tuvo un
   * mensaje hace menos de GRACIA_EN_CURSO_MS. Así una atención que empezó antes
   * del cierre se termina, y un chat nuevo espera al horario siguiente.
   */
  async debeAtender(userId: string, remoteJid: string, ahora: Date): Promise<boolean> {
    if (dentroDelHorario(await this.leer(userId), ahora)) return true;
    const ultimo = await this.prisma.message.findFirst({
      where: { conversation: { userId, remoteJid } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return ultimo !== null && ahora.getTime() - ultimo.createdAt.getTime() < GRACIA_EN_CURSO_MS;
  }
}
