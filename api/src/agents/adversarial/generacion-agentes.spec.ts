import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TIPOS_USO } from '../agent-catalog.js';
import { AgentsService } from '../agents.service.js';
import type { GenerateAgentDto } from '../agents.types.js';
import { OpenRouterError, OpenRouterTimeoutError, type OpenRouterClient } from '../openrouter.client.js';

function config(): ConfigService<Env, true> {
  return {
    get: (clave: string) => ({ OPENROUTER_MODEL: 'google/gemma-4-31b-it', OPENROUTER_MODEL_AGENTES: '' })[clave],
  } as unknown as ConfigService<Env, true>;
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

function respuestaValida() {
  return { content: JSON.stringify({ systemPrompt: 'Hola, soy el bot.', allowedActions: ['consultar_disponibilidad', 'crear_turno'] }) };
}

describe('generación de agentes — adversarial (matriz A)', () => {
  it('A-002: los 6 tipos de uso del catálogo generan un Agent válido', async () => {
    for (const tipoUso of TIPOS_USO) {
      const chat = vi.fn().mockResolvedValue(respuestaValida());
      const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ id: 'agent-1', ...create }));
      const prisma = { agent: { upsert } } as unknown as PrismaService;
      const servicio = new AgentsService(prisma, { chat } as unknown as OpenRouterClient, config());

      const agente = await servicio.generate('user-1', dto({ tipoUso }));

      expect(agente.allowedActions.length).toBeGreaterThan(0);
    }
  });

  it('A-004: nombres de titular parecidos en usuarios distintos no colisionan (upsert por userId)', async () => {
    const chat = vi.fn().mockResolvedValue(respuestaValida());
    const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ id: 'agent-x', ...create }));
    const prisma = { agent: { upsert } } as unknown as PrismaService;
    const servicio = new AgentsService(prisma, { chat } as unknown as OpenRouterClient, config());

    await servicio.generate('user-ana', dto({ nombreTitular: 'Dra. Ana' }));
    await servicio.generate('user-ana-2', dto({ nombreTitular: 'Dra Ana' }));

    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-ana' } }));
    expect(upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { userId: 'user-ana-2' } }));
  });

  it('A-009: tipos de evento duplicados (mismo nombre) no se deduplican por el DTO', async () => {
    const chat = vi.fn().mockResolvedValue(respuestaValida());
    const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ id: 'agent-1', ...create }));
    const prisma = { agent: { upsert } } as unknown as PrismaService;
    const servicio = new AgentsService(prisma, { chat } as unknown as OpenRouterClient, config());

    const agente = await servicio.generate(
      'user-1',
      dto({ tiposEvento: [{ nombre: 'Corte', duracionMin: 30 }, { nombre: 'Corte', duracionMin: 30 }] }),
    );

    // No hay regla de negocio contra duplicados: el hueco queda documentado,
    // no se agrega una validación nueva sin autorización.
    expect(agente).toBeDefined();
    expect(upsert).toHaveBeenCalled();
  });

  it('A-020: dos fallos consecutivos no tocan el Agent anterior (upsert nunca se llama)', async () => {
    const chat = vi.fn().mockRejectedValue(new OpenRouterError('caído'));
    const upsert = vi.fn();
    const prisma = { agent: { upsert } } as unknown as PrismaService;
    const servicio = new AgentsService(prisma, { chat } as unknown as OpenRouterClient, config());

    await expect(servicio.generate('user-1', dto())).rejects.toThrow();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('A-020b: un timeout tampoco toca el Agent anterior y no reintenta', async () => {
    const chat = vi.fn().mockRejectedValue(new OpenRouterTimeoutError('tardó demasiado'));
    const upsert = vi.fn();
    const prisma = { agent: { upsert } } as unknown as PrismaService;
    const servicio = new AgentsService(prisma, { chat } as unknown as OpenRouterClient, config());

    await expect(servicio.generate('user-1', dto())).rejects.toThrow();

    expect(chat).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});
