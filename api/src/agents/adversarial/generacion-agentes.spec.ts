import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TIPOS_USO } from '../agent-catalog.js';
import { AgentsService } from '../agents.service.js';
import type { GenerateAgentDto } from '../agents.types.js';

function crearServicio() {
  const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', ...create }),
  );
  // Sin agente previo: el chequeo de "no cambiar de tipo" no encuentra nada.
  const prisma = { agent: { upsert, findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService;
  return { service: new AgentsService(prisma), upsert };
}

function dto(overrides: Partial<GenerateAgentDto> = {}): GenerateAgentDto {
  return {
    tipoTitular: 'negocio',
    nombreTitular: 'Negocio de prueba',
    tipoUso: 'comercio',
    tiposEvento: [{ nombre: 'Turno', duracionMin: 30 }],
    horaDesde: '09:00',
    horaHasta: '18:00',
    nombreBot: 'Bot',
    ...overrides,
  } as GenerateAgentDto;
}

describe('generación de agentes — adversarial (matriz A)', () => {
  it('A-002: los 6 tipos de uso del catálogo generan un Agent válido', async () => {
    for (const tipoUso of TIPOS_USO) {
      const { service } = crearServicio();

      const agente = await service.generate('user-1', dto({ tipoUso }));

      expect(agente.allowedActions.length).toBeGreaterThan(0);
    }
  });

  it('A-004: nombres de titular parecidos en usuarios distintos no colisionan (upsert por userId)', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-ana', dto({ nombreTitular: 'Dra. Ana' }));
    await service.generate('user-ana-2', dto({ nombreTitular: 'Dra Ana' }));

    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-ana' } }));
    expect(upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { userId: 'user-ana-2' } }));
  });

  it('A-009: tipos de evento duplicados (mismo nombre) no se deduplican por el DTO', async () => {
    const { service, upsert } = crearServicio();

    const agente = await service.generate(
      'user-1',
      dto({ tiposEvento: [{ nombre: 'Corte', duracionMin: 30 }, { nombre: 'Corte', duracionMin: 30 }] }),
    );

    // No hay regla de negocio contra duplicados: el hueco queda documentado,
    // no se agrega una validación nueva sin autorización.
    expect(agente).toBeDefined();
    expect(upsert).toHaveBeenCalled();
  });

  it('A-020 (ya no aplica): sin llamada a un LLM, no hay fallo externo que pueda dejar el Agent a medio escribir', async () => {
    const { service, upsert } = crearServicio();
    upsert.mockRejectedValueOnce(new Error('la base está caída'));

    await expect(service.generate('user-1', dto())).rejects.toThrow('la base está caída');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
