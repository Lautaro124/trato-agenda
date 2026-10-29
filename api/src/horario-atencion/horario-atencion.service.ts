import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  datosDelHorario,
  dentroDelHorario,
  GRACIA_EN_CURSO_MS,
  leerHorarioAtencion,
  mismoCierre,
  normalizarHorarioAtencion,
  resumenHorarioAtencion,
  ZONA_POR_DEFECTO,
  type HorarioAtencion,
  type HorarioAtencionEntrada,
} from './horario-atencion.rules.js';
import type { HorarioAtencionPublico } from './horario-atencion.types.js';

/** `avisar`: mandar el aviso de vendedor no disponible y no correr el asistente. */
export type Atencion = 'atender' | 'avisar' | 'ignorar';

const COLUMNAS ={ horarioAtencionActivo: true, horarioAtencion: true, zonaHoraria: true } as const;

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
   * Qué hacer con un mensaje de este chat ahora. Dentro del horario (o sin
   * restricción), atenderlo. Fuera, se atiende sólo si la conversación está en
   * curso: tuvo un mensaje hace menos de GRACIA_EN_CURSO_MS. Así una atención
   * que empezó antes del cierre se termina, y un chat nuevo espera al horario
   * siguiente en silencio. Un chat ya iniciado recibe el aviso de vendedor no
   * disponible una vez por cierre (LAU-37).
   */
  async atencion(userId: string, remoteJid: string, ahora: Date): Promise<Atencion> {
    const horario = await this.leer(userId);
    if (dentroDelHorario(horario, ahora)) return 'atender';
    const conversation = await this.prisma.conversation.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: {
        id: true,
        avisoFueraDeHorarioAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });
    const ultimo = conversation?.messages[0];
    if (!conversation || !ultimo) return 'ignorar';
    if (ahora.getTime() - ultimo.createdAt.getTime() < GRACIA_EN_CURSO_MS) return 'atender';

    const avisado = conversation.avisoFueraDeHorarioAt;
    if (avisado && mismoCierre(horario, avisado, ahora)) return 'ignorar';
    // Se reclama contra el valor leído: de dos mensajes a la vez, avisa uno solo.
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversation.id, avisoFueraDeHorarioAt: avisado },
      data: { avisoFueraDeHorarioAt: ahora },
    });
    return count === 1 ? 'avisar' : 'ignorar';
  }
}
