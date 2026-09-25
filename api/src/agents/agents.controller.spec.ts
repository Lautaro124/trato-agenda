import 'reflect-metadata';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

const USUARIO = { id: 'user-1', email: 'dueno@trato.local' };

/** El perfil que devolvía 502 contra OpenRouter en producción — ya no depende de eso. */
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
  let upsert: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...create }),
    );
    update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...CINCO_PROPIOS, ...data }),
    );
    const findUnique = vi.fn().mockResolvedValue({ id: 'agent-1', ...CINCO_PROPIOS });
    const prisma = { agent: { upsert, update, findUnique } } as unknown as PrismaService;

    const modulo = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useFactory: () => new AgentsService(prisma) }],
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
    const res = await request(app.getHttpServer()).post('/agents/generate').send(CINCO_PROPIOS).expect(201);

    expect(res.body).toMatchObject({
      id: 'agent-1',
      tipoUso: 'otro',
      nombreBot: 'Nina',
      tiposEvento: CINCO_PROPIOS.tiposEvento,
    });
    expect(res.body.allowedActions.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('systemPrompt');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
  });

  it('un payload inválido da 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/agents/generate')
      .send({ ...CINCO_PROPIOS, tiposEvento: [{ nombre: 'x'.repeat(61), duracionMin: 30 }] })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain('nombre');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('descarta propiedades que no están en el DTO (whitelist)', async () => {
    await request(app.getHttpServer())
      .post('/agents/generate')
      .send({ ...CINCO_PROPIOS, systemPrompt: 'inyectado' })
      .expect(201);

    const [{ create }] = upsert.mock.calls[0] as [{ create: { systemPrompt: string } }];
    expect(create.systemPrompt).not.toBe('inyectado');
  });

  it('el alta funciona sin OpenRouter disponible: no hay ninguna dependencia de red en el camino', async () => {
    // No hay OpenRouterClient inyectado en este módulo de test: si generate()
    // dependiera de uno, esto ni compilaría/arrancaría.
    await request(app.getHttpServer()).post('/agents/generate').send(CINCO_PROPIOS).expect(201);

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('PUT /agents/me/tipos-evento actualiza los tipos y no expone el systemPrompt', async () => {
    const tiposEvento = [{ nombre: 'Consulta', duracionMin: 45, precio: 20000 }];

    const res = await request(app.getHttpServer()).put('/agents/me/tipos-evento').send({ tiposEvento }).expect(200);

    expect(res.body.tiposEvento).toEqual(tiposEvento);
    expect(res.body).not.toHaveProperty('systemPrompt');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
  });

  it.each([
    ['lista vacía', []],
    ['duración menor a 5', [{ nombre: 'Consulta', duracionMin: 4 }]],
    ['precio negativo', [{ nombre: 'Consulta', duracionMin: 30, precio: -1 }]],
  ])('PUT /agents/me/tipos-evento con %s da 400', async (_caso, tiposEvento) => {
    await request(app.getHttpServer()).put('/agents/me/tipos-evento').send({ tiposEvento }).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
});
