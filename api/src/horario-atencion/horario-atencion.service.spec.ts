import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { GRACIA_EN_CURSO_MS, ZONA_POR_DEFECTO } from './horario-atencion.rules.js';
import { HorarioAtencionService } from './horario-atencion.service.js';

const JID = '5491111@s.whatsapp.net';
// Jueves 8 de octubre de 2026 a las 20:00 en Buenos Aires: fuera de un horario de 9 a 18.
const AHORA = new Date('2026-10-08T20:00:00-03:00');

function crearServicio(user: unknown, ultimoMensaje: Date | null = null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    message: {
      findFirst: vi.fn().mockResolvedValue(ultimoMensaje ? { createdAt: ultimoMensaje } : null),
    },
  };
  return { service: new HorarioAtencionService(prisma as unknown as PrismaService), prisma };
}

const conHorario = {
  horarioAtencionActivo: true,
  horarioAtencion: [{ dia: 'jue', desde: '09:00', hasta: '18:00' }],
  zonaHoraria: ZONA_POR_DEFECTO,
};

describe('HorarioAtencionService.debeAtender', () => {
  it('sin restricción atiende sin mirar la conversación', async () => {
    const { service, prisma } = crearServicio({ ...conHorario, horarioAtencionActivo: false });
    await expect(service.debeAtender('user-1', JID, AHORA)).resolves.toBe(true);
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('fuera de horario, un chat sin mensajes no se atiende', async () => {
    const { service, prisma } = crearServicio(conHorario);
    await expect(service.debeAtender('user-1', JID, AHORA)).resolves.toBe(false);
    // Busca sólo en la conversación de este dueño con este cliente.
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversation: { userId: 'user-1', remoteJid: JID } } }),
    );
  });

  it('fuera de horario, una conversación en curso se termina de atender', async () => {
    const reciente = new Date(AHORA.getTime() - GRACIA_EN_CURSO_MS + 60_000);
    const { service } = crearServicio(conHorario, reciente);
    await expect(service.debeAtender('user-1', JID, AHORA)).resolves.toBe(true);
  });

  it('pasada la gracia, la conversación ya no está en curso', async () => {
    const vieja = new Date(AHORA.getTime() - GRACIA_EN_CURSO_MS);
    const { service } = crearServicio(conHorario, vieja);
    await expect(service.debeAtender('user-1', JID, AHORA)).resolves.toBe(false);
  });

  it('una cuenta que ya no existe no apaga nada', async () => {
    const { service } = crearServicio(null);
    await expect(service.debeAtender('user-1', JID, AHORA)).resolves.toBe(true);
  });
});

describe('HorarioAtencionService.actualizar', () => {
  it('guarda lo normalizado en el usuario de la sesión', async () => {
    const { service, prisma } = crearServicio(conHorario);
    const publico = await service.actualizar('user-1', {
      activo: true,
      franjas: [{ dia: 'lun', desde: '09:00', hasta: '18:00' }],
      zona: 'America/Lima',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        horarioAtencionActivo: true,
        horarioAtencion: [{ dia: 'lun', desde: '09:00', hasta: '18:00' }],
        zonaHoraria: 'America/Lima',
      },
    });
    expect(publico.resumen).toBe('lunes de 09:00 a 18:00');
  });

  it('un horario inválido es un 400 y no toca la base', async () => {
    const { service, prisma } = crearServicio(conHorario);
    await expect(service.actualizar('user-1', { activo: true, franjas: [], zona: ZONA_POR_DEFECTO })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
