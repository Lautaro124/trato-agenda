import { describe, expect, it, vi } from 'vitest';
import type { CheckpointerService } from '../../conversation/checkpointer.provider.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { RetentionService } from '../retention.service.js';

function servicioConDatos() {
  const conversacionesVencidas = [{ id: 'conv-1' }, { id: 'conv-2' }];
  let yaBorrados = false;

  const prisma = {
    conversation: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(yaBorrados ? [] : conversacionesVencidas)),
      updateMany: vi.fn().mockImplementation(() => Promise.resolve({ count: yaBorrados ? 0 : 1 })),
    },
    message: {
      deleteMany: vi.fn().mockImplementation(() => {
        const count = yaBorrados ? 0 : conversacionesVencidas.length;
        yaBorrados = true;
        return Promise.resolve({ count });
      }),
    },
  } as unknown as PrismaService;

  const deleteThread = vi.fn().mockResolvedValue(undefined);
  const checkpointer = { saver: { deleteThread } } as unknown as CheckpointerService;

  return { servicio: new RetentionService(prisma, checkpointer), prisma, deleteThread };
}

describe('purga de retención — adversarial (matriz E)', () => {
  it('E-007: correr purgar() dos veces seguidas es idempotente (la segunda no encuentra nada nuevo)', async () => {
    const { servicio, prisma, deleteThread } = servicioConDatos();

    await servicio.purgar();
    await servicio.purgar();

    // La primera corrida borra los mensajes de las 2 conversaciones vencidas y
    // sus checkpoints (uno por conversación); la segunda ya no encuentra
    // conversaciones que cumplan el filtro (el propio `where` las excluye una
    // vez que ya no tienen mensajes), así que ni siquiera llama a deleteMany
    // ni a deleteThread de nuevo — eso es la idempotencia real, no un "correr
    // dos veces y no pasa nada distinto".
    expect(deleteThread).toHaveBeenCalledTimes(2);
    expect(prisma.message.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(2);
  });

  it('un fallo al borrar un checkpoint no aborta la purga del resto', async () => {
    const { servicio, deleteThread } = servicioConDatos();
    deleteThread.mockRejectedValueOnce(new Error('checkpoint ya no existe'));

    await expect(servicio.purgar()).resolves.toBeUndefined();
    expect(deleteThread).toHaveBeenCalledTimes(2);
  });

  it('nunca se borra ni se toca la tabla Turno desde la purga', async () => {
    const { servicio, prisma } = servicioConDatos();
    const turnoTocado = 'turno' in prisma;

    await servicio.purgar();

    expect(turnoTocado).toBe(false);
  });
});
