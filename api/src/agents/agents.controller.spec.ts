import 'reflect-metadata';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { OpenRouterClient, OpenRouterTimeoutError } from './openrouter.client.js';

const USUARIO = { id: 'user-1', email: 'dueno@trato.local' };

/** El perfil que devolvió 502 en producción. */
const CINCO_PROPIOS = {
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

describe('POST /agents/generate', () => {
  let app: INestApplication;
  let chat: ReturnType<typeof vi.fn>;
  let upsert: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    chat = vi.fn();
    upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...create }),
    );
    const prisma = { agent: { upsert } } as unknown as PrismaService;
    const openRouter = { chat } as unknown as OpenRouterClient;
    const config = {
      get: (clave: string) => ({ OPENROUTER_MODEL: 'google/gemma-4-31b-it', OPENROUTER_MODEL_AGENTES: '' })[clave],
    } as unknown as ConfigService<Env, true>;

    const modulo = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useFactory: () => new AgentsService(prisma, openRouter, config) }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = USUARIO;
          return true;
        },
      })
      .compile();

    app = modulo.createNestApplication({ logger: false });
    // Igual que main.ts: sin esto los DTOs no se validan.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('genera el perfil de producción con cinco tipos propios y no expone el systemPrompt', async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'Sos Nina.', allowedActions: ['consultar_disponibilidad', 'crear_turno'] }),
    });

    const res = await request(app.getHttpServer()).post('/agents/generate').send(CINCO_PROPIOS).expect(201);

    expect(res.body).toMatchObject({
      id: 'agent-1',
      tipoUso: 'otro',
      nombreBot: 'Nina',
      tiposEvento: CINCO_PROPIOS.tiposEvento,
      allowedActions: ['consultar_disponibilidad', 'crear_turno'],
    });
    expect(res.body).not.toHaveProperty('systemPrompt');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
  });

  it('un payload inválido da 400 sin llamar a OpenRouter', async () => {
    const res = await request(app.getHttpServer())
      .post('/agents/generate')
      .send({ ...CINCO_PROPIOS, tiposEvento: [{ nombre: 'x'.repeat(61), duracionMin: 30 }] })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain('nombre');
    expect(chat).not.toHaveBeenCalled();
  });

  it('descarta propiedades que no están en el DTO (whitelist)', async () => {
    chat.mockResolvedValue({ content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }) });

    await request(app.getHttpServer())
      .post('/agents/generate')
      .send({ ...CINCO_PROPIOS, systemPrompt: 'inyectado' })
      .expect(201);

    const [{ create }] = upsert.mock.calls[0] as [{ create: { systemPrompt: string } }];
    expect(create.systemPrompt).toBe('ok');
  });

  it('un timeout de OpenRouter da 502 tras un único intento', async () => {
    chat.mockRejectedValue(new OpenRouterTimeoutError('OpenRouter no respondió en 60000ms.'));

    await request(app.getHttpServer()).post('/agents/generate').send(CINCO_PROPIOS).expect(502);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});
