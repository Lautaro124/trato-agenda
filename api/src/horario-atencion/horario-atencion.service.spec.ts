import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { GRACIA_EN_CURSO_MS, ZONA_POR_DEFECTO } from './horario-atencion.rules.js';
import { HorarioAtencionService } from './horario-atencion.service.js';

const JID = '5491111@s.whatsapp.net';
// Jueves 8 de octubre de 2026 a las 20:00 en Buenos Aires: fuera de un horario de 9 a 18.
const AHORA = new Date('2026-10-08T20:00:00-03:00');

type ConversacionMock = { avisoFueraDeHorarioAt?: Date | null; ultimoMensaje?: Date | null };

function crearServicio(user: unknown, conversacion: ConversacionMock | null = null, reclamadas = 1) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    conversation: {
      findUnique: vi.fn().mockResolvedValue(
        conversacion && {
          id: 'conv-1',
          avisoFueraDeHorarioAt: conversacion.avisoFueraDeHorarioAt ?? null,
          messages: conversacion.ultimoMensaje ? [{ createdAt: conversacion.ultimoMensaje }] : [],
        },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: reclamadas }),
    },
  };
  return { service: new HorarioAtencionService(prisma as unknown as PrismaService), prisma };
}

const conHorario = {
  horarioAtencionActivo: true,
  horarioAtencion: [{ dia: 'jue', desde: '09:00', hasta: '18:00' }],
  zonaHoraria: ZONA_POR_DEFECTO,
};

/** Pasada la gracia: la conversación ya no está en curso. */
const VIEJO = new Date(AHORA.getTime() - GRACIA_EN_CURSO_MS);

describe('HorarioAtencionService.atencion', () => {
  it('sin restricción atiende sin mirar la conversación', async () => {
    const { service, prisma } = crearServicio({ ...conHorario, horarioAtencionActivo: false });
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('atender');
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('dentro del horario atiende y no avisa', async () => {
    const { service, prisma } = crearServicio(conHorario, { ultimoMensaje: VIEJO });
    await expect(service.atencion('user-1', JID, new Date('2026-10-08T12:00:00-03:00'))).resolves.toBe('atender');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('fuera de horario, un chat nuevo no se atiende ni se avisa', async () => {
    const { service, prisma } = crearServicio(conHorario);
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('ignorar');
    // Busca sólo la conversación de este dueño con este cliente.
    expect(prisma.conversation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_remoteJid: { userId: 'user-1', remoteJid: JID } } }),
    );
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('una conversación sin mensajes cuenta como chat nuevo', async () => {
    const { service } = crearServicio(conHorario, {});
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('ignorar');
  });

  it('fuera de horario, una conversación en curso se termina de atender', async () => {
    const reciente = new Date(AHORA.getTime() - GRACIA_EN_CURSO_MS + 60_000);
    const { service, prisma } = crearServicio(conHorario, { ultimoMensaje: reciente });
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('atender');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('pasada la gracia, un chat ya iniciado recibe el aviso y queda marcado', async () => {
    const { service, prisma } = crearServicio(conHorario, { ultimoMensaje: VIEJO });
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('avisar');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', avisoFueraDeHorarioAt: null },
      data: { avisoFueraDeHorarioAt: AHORA },
    });
  });

  it('en el mismo cierre no repite el aviso', async () => {
    // Avisado a las 18:30 del jueves; a las 20:00 sigue el mismo cierre.
    const { service, prisma } = crearServicio(conHorario, {
      ultimoMensaje: VIEJO,
      avisoFueraDeHorarioAt: new Date('2026-10-08T18:30:00-03:00'),
    });
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('ignorar');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('tras volver a abrir, el cierre siguiente avisa otra vez', async () => {
    // Avisado el jueves anterior a las 20:00: después abrió hoy a las 09:00.
    const avisado = new Date('2026-10-01T20:00:00-03:00');
    const { service, prisma } = crearServicio(conHorario, { ultimoMensaje: VIEJO, avisoFueraDeHorarioAt: avisado });
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('avisar');
    // Reclama contra el valor leído.
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', avisoFueraDeHorarioAt: avisado },
      data: { avisoFueraDeHorarioAt: AHORA },
    });
  });

  it('si otro mensaje ya reclamó el aviso, éste no avisa', async () => {
    const { service } = crearServicio(conHorario, { ultimoMensaje: VIEJO }, 0);
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('ignorar');
  });

  it('una cuenta que ya no existe no apaga nada', async () => {
    const { service } = crearServicio(null);
    await expect(service.atencion('user-1', JID, AHORA)).resolves.toBe('atender');
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

describe('HorarioAtencionService.puedeEscribir', () => {
  const conUltimo = (user: unknown, ultimo: Date | null) => {
    const { service, prisma } = crearServicio(user);
    const findFirst = vi.fn().mockResolvedValue(ultimo && { createdAt: ultimo });
    (prisma as unknown as { message: { findFirst: typeof findFirst } }).message = { findFirst };
    return { service, findFirst };
  };

  it('dentro del horario, o sin restricción, puede sin mirar el chat', async () => {
    const dentro = conUltimo(conHorario, null);
    await expect(dentro.service.puedeEscribir('user-1', 'conv-1', new Date('2026-10-08T12:00:00-03:00'))).resolves.toBe(true);
    expect(dentro.findFirst).not.toHaveBeenCalled();

    const sinRestriccion = conUltimo({ ...conHorario, horarioAtencionActivo: false }, null);
    await expect(sinRestriccion.service.puedeEscribir('user-1', 'conv-1', AHORA)).resolves.toBe(true);
  });

  it('fuera de horario, sólo con la conversación en curso, y busca sólo en los chats del dueño', async () => {
    const enCurso = conUltimo(conHorario, new Date(AHORA.getTime() - GRACIA_EN_CURSO_MS + 60_000));
    await expect(enCurso.service.puedeEscribir('user-1', 'conv-1', AHORA)).resolves.toBe(true);
    expect(enCurso.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'conv-1', conversation: { userId: 'user-1' } } }),
    );

    await expect(conUltimo(conHorario, VIEJO).service.puedeEscribir('user-1', 'conv-1', AHORA)).resolves.toBe(false);
    await expect(conUltimo(conHorario, null).service.puedeEscribir('user-1', 'conv-1', AHORA)).resolves.toBe(false);
  });
});
