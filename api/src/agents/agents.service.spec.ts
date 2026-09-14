import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_IDS } from './agent-catalog.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import { AgentsService, construirDescripcion } from './agents.service.js';
import type { GenerateAgentDto } from './agents.types.js';

function crearServicio() {
  const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...create }),
  );
  const findUnique = vi.fn();
  const prisma = { agent: { upsert, findUnique } } as unknown as PrismaService;

  return { service: new AgentsService(prisma), prisma, upsert, findUnique };
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

/** El perfil que rompía con 502 contra OpenRouter: ya no depende de eso. */
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
  it('no depende de ningún cliente HTTP/LLM: el constructor no recibe uno', () => {
    // AgentsService sólo toma PrismaService — si necesitara OpenRouter para
    // generar, este test de tipos/constructor ya no compilaría.
    const { service } = crearServicio();
    expect(service).toBeInstanceOf(AgentsService);
  });

  it('persiste exactamente la config que produce el constructor determinista', async () => {
    const { service, upsert } = crearServicio();
    const esperado = construirConfiguracion(dto);

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          systemPrompt: esperado.systemPrompt,
          allowedActions: esperado.allowedActions,
          model: null,
          templateVersion: PLANTILLA_VERSION,
        }),
      }),
    );
  });

  it('genera el perfil de producción ("otro", cinco tipos propios con caracteres raros) sin fallar', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dtoCincoPropios);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoUso: 'otro',
          tiposEvento: dtoCincoPropios.tiposEvento,
          descripcion: expect.stringContaining('Taller grupal de iluminación para principiantes y curiosos (120 min)'),
        }),
      }),
    );
  });

  it('funciona sin OPENROUTER_API_KEY ni red: cero llamadas externas en todo el alta', async () => {
    // No hay ConfigService ni OpenRouterClient inyectados: no hay forma de
    // que generate() intente una llamada de red, simulada o real.
    const { service, upsert } = crearServicio();

    await expect(service.generate('user-1', dto)).resolves.toBeDefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('propaga un error de persistencia sin devolver éxito falso', async () => {
    const { service, upsert } = crearServicio();
    upsert.mockRejectedValueOnce(new Error('la base está caída'));

    await expect(service.generate('user-1', dto)).rejects.toThrow('la base está caída');
  });

  it('repetir el alta para el mismo userId actualiza el mismo row (upsert), no duplica', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);
    await service.generate('user-1', { ...dto, nombreBot: 'Otro nombre' });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toMatchObject({ where: { userId: 'user-1' } });
    expect(upsert.mock.calls[1][0]).toMatchObject({ where: { userId: 'user-1' } });
  });

  it('rechaza una franja horaria invertida sin tocar Prisma', async () => {
    const { service, upsert } = crearServicio();

    await expect(
      service.generate('user-1', { ...dto, horaDesde: '18:00', horaHasta: '09:00' }),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persiste los campos del wizard y una descripción derivada de ellos', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
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

  it('allowedActions son exactamente las 5 del catálogo', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ allowedActions: ACCIONES_IDS }) }),
    );
  });

  it('un agente ya existente generado por IA (model no nulo, templateVersion nulo) se puede leer sin romper', async () => {
    const { service, findUnique } = crearServicio();
    findUnique.mockResolvedValue({
      id: 'agent-viejo',
      userId: 'user-1',
      model: 'openai/gpt-4o-mini',
      templateVersion: null,
      systemPrompt: 'generado por IA hace tiempo',
      allowedActions: ['crear_turno'],
    });

    const agente = await service.findByUserId('user-1');

    expect(agente).toMatchObject({ model: 'openai/gpt-4o-mini', templateVersion: null });
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
