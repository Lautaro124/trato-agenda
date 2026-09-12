import { BadGatewayException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_IDS } from './agent-catalog.js';
import {
  AgentsService,
  MAX_TOKENS_GENERACION,
  TIMEOUT_GENERACION_MS,
  construirDescripcion,
} from './agents.service.js';
import type { GenerateAgentDto } from './agents.types.js';
import { OpenRouterError, OpenRouterTimeoutError, type OpenRouterClient } from './openrouter.client.js';

function crearServicio(chatMock: ReturnType<typeof vi.fn>, entorno: Partial<Record<keyof Env, string>> = {}) {
  const prisma = {
    agent: { upsert: vi.fn().mockResolvedValue({ id: 'agent-1' }) },
  } as unknown as PrismaService;

  const openRouter = { chat: chatMock } as unknown as OpenRouterClient;

  const valores: Record<string, string> = {
    OPENROUTER_MODEL: 'openai/gpt-4o-mini',
    OPENROUTER_MODEL_AGENTES: '',
    ...entorno,
  };
  const config = {
    get: (clave: string) => valores[clave],
  } as unknown as ConfigService<Env, true>;

  return { service: new AgentsService(prisma, openRouter, config), prisma };
}

function configValida(acciones: string[] = ['consultar_disponibilidad', 'crear_turno']) {
  return { content: JSON.stringify({ systemPrompt: 'ok', allowedActions: acciones }) };
}

type LlamadaChat = {
  messages: { role: string; content: string }[];
  model?: string;
  jsonSchema?: { name: string; schema: { properties: { allowedActions: { items: { enum: string[] } } } } };
  timeoutMs?: number;
  maxTokens?: number;
};

function llamada(chat: ReturnType<typeof vi.fn>, indice = 0): LlamadaChat {
  return (chat.mock.calls[indice] as [LlamadaChat])[0];
}

const dto: GenerateAgentDto = {
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  tipoUso: 'comercio',
  tiposEvento: [
    { nombre: 'Probador', duracionMin: 20 },
    { nombre: 'Presupuesto', duracionMin: 30 },
  ],
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreBot: 'Tati',
};

/** El perfil que falló en producción: tipo de uso "otro" y cinco tipos de turno propios. */
const dtoCincoPropios: GenerateAgentDto = {
  tipoTitular: 'negocio',
  nombreTitular: 'Estudio "La Ñata" & Cía',
  tipoUso: 'otro',
  tiposEvento: [
    { nombre: 'Sesión de fotos en exterior', duracionMin: 90 },
    { nombre: 'Retoque 💇‍♀️ express', duracionMin: 15 },
    { nombre: 'Entrega de álbum / revisión', duracionMin: 30 },
    { nombre: 'Consulta "previa" por videollamada', duracionMin: 20 },
    { nombre: 'Taller grupal de iluminación para principiantes y curiosos', duracionMin: 120 },
  ],
  horaDesde: '10:00',
  horaHasta: '19:00',
  nombreBot: 'Nina',
};

describe('AgentsService.generate', () => {
  it('persiste la config cuando OpenRouter devuelve un JSON válido de una', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        systemPrompt: 'Sos el agente de una tienda de ropa.',
        allowedActions: ['consultar_disponibilidad', 'crear_turno'],
      }),
    });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          systemPrompt: 'Sos el agente de una tienda de ropa.',
          allowedActions: ['consultar_disponibilidad', 'crear_turno'],
          model: 'openai/gpt-4o-mini',
        }),
      }),
    );
  });

  it('genera el perfil de producción: "otro" con cinco tipos propios con caracteres raros', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dtoCincoPropios);

    const usuario = llamada(chat).messages.find((mensaje) => mensaje.role === 'user')?.content ?? '';
    for (const tipo of dtoCincoPropios.tiposEvento) {
      expect(usuario).toContain(`${tipo.nombre} (${tipo.duracionMin} min)`);
    }
    expect(usuario).toContain('Tipo de uso: otro');
    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoUso: 'otro',
          tiposEvento: dtoCincoPropios.tiposEvento,
          descripcion: expect.stringContaining('Taller grupal de iluminación para principiantes y curiosos (120 min)'),
        }),
      }),
    );
  });

  it('pide structured outputs con el catálogo como enum, timeout largo y tope de tokens', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service } = crearServicio(chat);

    await service.generate('user-1', dto);

    const opciones = llamada(chat);
    expect(opciones.timeoutMs).toBe(TIMEOUT_GENERACION_MS);
    expect(opciones.maxTokens).toBe(MAX_TOKENS_GENERACION);
    expect(opciones.jsonSchema?.schema.properties.allowedActions.items.enum).toEqual(ACCIONES_IDS);
  });

  it('usa OPENROUTER_MODEL_AGENTES cuando está definido y lo persiste', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service, prisma } = crearServicio(chat, { OPENROUTER_MODEL_AGENTES: 'deepseek/deepseek-v4-flash:nitro' });

    await service.generate('user-1', dto);

    expect(llamada(chat).model).toBe('deepseek/deepseek-v4-flash:nitro');
    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ model: 'deepseek/deepseek-v4-flash:nitro' }) }),
    );
  });

  it('sin OPENROUTER_MODEL_AGENTES cae en OPENROUTER_MODEL', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(llamada(chat).model).toBe('openai/gpt-4o-mini');
  });

  it('reintenta una vez si el primer JSON es inválido y se recupera', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: 'esto no es JSON' })
      .mockResolvedValueOnce({
        content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }),
      });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(2);
    // El reintento por JSON roto le marca el error al modelo.
    expect(llamada(chat, 1).messages).toHaveLength(4);
    expect(prisma.agent.upsert).toHaveBeenCalledTimes(1);
  });

  it('tira BadGatewayException si falla dos veces seguidas', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'esto no es JSON' });
    const { service, prisma } = crearServicio(chat);

    await expect(service.generate('user-1', dto)).rejects.toThrow(BadGatewayException);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('un timeout no se reintenta: duplicaría la espera (el 502 de 40s de producción)', async () => {
    const chat = vi.fn().mockRejectedValue(new OpenRouterTimeoutError('OpenRouter no respondió en 60000ms.'));
    const { service, prisma } = crearServicio(chat);

    const error = await service.generate('user-1', dtoCincoPropios).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toContain('60000ms');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('un error de transporte (5xx) se reintenta con el mismo pedido, sin marcar JSON inválido', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new OpenRouterError('OpenRouter respondió 503: overloaded'))
      .mockResolvedValueOnce(configValida());
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(llamada(chat, 1).messages).toEqual(llamada(chat, 0).messages);
    expect(prisma.agent.upsert).toHaveBeenCalledTimes(1);
  });

  it('acepta el JSON envuelto en un bloque ```json', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: '```json\n{"systemPrompt": "Sos Nina.", "allowedActions": ["crear_turno"]}\n```',
    });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ systemPrompt: 'Sos Nina.' }) }),
    );
  });

  it('deduplica allowedActions', async () => {
    const chat = vi.fn().mockResolvedValue(configValida(['crear_turno', 'crear_turno', 'cancelar_turno']));
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowedActions: ['crear_turno', 'cancelar_turno'] }),
      }),
    );
  });

  it('rechaza allowedActions vacío: un agente sin acciones no puede agendar', async () => {
    const chat = vi.fn().mockResolvedValue(configValida([]));
    const { service, prisma } = crearServicio(chat);

    await expect(service.generate('user-1', dto)).rejects.toThrow(BadGatewayException);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('rechaza una acción fuera del catálogo', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['mandar_flores'] }),
    });
    const { service, prisma } = crearServicio(chat);

    await expect(service.generate('user-1', dto)).rejects.toThrow();
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('rechaza una franja horaria invertida sin llamar a OpenRouter', async () => {
    const chat = vi.fn();
    const { service, prisma } = crearServicio(chat);

    await expect(
      service.generate('user-1', { ...dto, horaDesde: '18:00', horaHasta: '09:00' }),
    ).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('persiste los campos del wizard y una descripción derivada de ellos', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }),
    });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoTitular: 'negocio',
          nombreTitular: 'Tienda Centro',
          nombreBot: 'Tati',
          horaDesde: '09:00',
          horaHasta: '18:00',
          tiposEvento: dto.tiposEvento,
        }),
      }),
    );
  });
});

describe('META_SYSTEM_PROMPT', () => {
  it('le pide al meta-agente que acote el agente generado a la agenda', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service } = crearServicio(chat);

    await service.generate('user-1', dto);

    const sistema = llamada(chat).messages.find((mensaje) => mensaje.role === 'system')?.content ?? '';

    expect(sistema).toContain('hablar ÚNICAMENTE de la agenda del titular');
    expect(sistema).toContain('mezclado con un pedido de turno');
    expect(sistema).toContain('no inventar datos del negocio');
  });

  it('pide un prompt corto porque las reglas duras ya las agrega el sistema', async () => {
    const chat = vi.fn().mockResolvedValue(configValida());
    const { service } = crearServicio(chat);

    await service.generate('user-1', dto);

    const sistema = llamada(chat).messages.find((mensaje) => mensaje.role === 'system')?.content ?? '';

    expect(sistema).toContain('200 palabras como máximo');
    expect(sistema).toContain('nombrar todos los tipos de turno');
  });
});

describe('construirDescripcion', () => {
  it('incluye titular, tipos de evento con su duración y la franja horaria', () => {
    const descripcion = construirDescripcion(dto);

    expect(descripcion).toContain('Tienda Centro');
    expect(descripcion).toContain('Probador (20 min)');
    expect(descripcion).toContain('Presupuesto (30 min)');
    expect(descripcion).toContain('de 09:00 a 18:00');
  });
});
