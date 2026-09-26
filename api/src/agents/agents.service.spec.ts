import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_IDS, ACCIONES_VENTAS_IDS } from './agent-catalog.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import { PLANTILLA_VENTAS_VERSION } from './agent-template-ventas.js';
import { AgentsService, construirDescripcion } from './agents.service.js';
import type { GenerateAgentDto } from './agents.types.js';

function crearServicio() {
  const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...create }),
  );
  const findUnique = vi.fn();
  const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...data }),
  );
  const prisma = { agent: { upsert, findUnique, update } } as unknown as PrismaService;

  return { service: new AgentsService(prisma), prisma, upsert, findUnique, update };
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

const agenteGuardado = {
  id: 'agent-1',
  userId: 'user-1',
  tipoUso: 'consultorio',
  tipoTitular: 'persona',
  nombreTitular: 'Dra. Pérez',
  nombreBot: 'Nina',
  horaDesde: '10:00',
  horaHasta: '17:00',
  tiposEvento: [{ nombre: 'Consulta', duracionMin: 30 }],
  allowedActions: ['crear_turno'],
  model: 'openai/gpt-4o-mini',
  templateVersion: null,
  systemPrompt: 'viejo',
};

describe('AgentsService.actualizarTiposEvento', () => {
  it('reemplaza los tipos y regenera el prompt con duración y precio nuevos, sin tocar el resto', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);
    const tipos = [{ nombre: ' Consulta ', duracionMin: 45, precio: 15000 }];

    await service.actualizarTiposEvento('user-1', tipos);

    const [{ where, data }] = update.mock.calls[0] as [{ where: unknown; data: Record<string, unknown> }];
    expect(where).toEqual({ userId: 'user-1' });
    expect(data.tiposEvento).toEqual([{ nombre: 'Consulta', duracionMin: 45, precio: 15000 }]);
    expect(data.systemPrompt).toContain('"Consulta" (45 min, $ 15.000)');
    expect(data.systemPrompt).toContain('de 10:00 a 17:00');
    expect(data.systemPrompt).toContain('Dra. Pérez');
    expect(data).toMatchObject({ model: null, templateVersion: PLANTILLA_VERSION });
    expect(data).not.toHaveProperty('allowedActions');
    expect(data).not.toHaveProperty('horaDesde');
  });

  it('da 404 si todavía no hay agente', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(
      service.actualizarTiposEvento('user-1', [{ nombre: 'Consulta', duracionMin: 30 }]),
    ).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 400 con nombres repetidos, sin importar mayúsculas ni espacios', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);

    await expect(
      service.actualizarTiposEvento('user-1', [
        { nombre: 'Consulta', duracionMin: 30 },
        { nombre: ' consulta ', duracionMin: 45 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AgentsService.generarVentas', () => {
  it('persiste un asistente de ventas con su plantilla y el catálogo de ventas entero', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', { nombreTitular: ' Mates "El Gaucho" ', nombreBot: 'Nina' });

    const [{ where, create }] = upsert.mock.calls[0] as [{ where: unknown; create: Record<string, unknown> }];
    expect(where).toEqual({ userId: 'user-1' });
    expect(create).toMatchObject({
      userId: 'user-1',
      tipoAsistente: 'ventas',
      tipoUso: 'comercio',
      tipoTitular: 'negocio',
      nombreTitular: 'Mates "El Gaucho"',
      nombreBot: 'Nina',
      tiposEvento: [],
      allowedActions: ACCIONES_VENTAS_IDS,
      model: null,
      templateVersion: PLANTILLA_VENTAS_VERSION,
    });
    // Los textos libres van escapados como dato, no como instrucción.
    expect(create.systemPrompt).toContain('"Mates \\"El Gaucho\\""');
    expect(create.systemPrompt).toContain('"Nina"');
    expect(create.systemPrompt).not.toContain('lunes a viernes');
  });

  it('se puede regenerar si ya era de ventas', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('no deja pasar una cuenta de agenda a ventas ni al revés (409)', async () => {
    const { service, findUnique, upsert } = crearServicio();

    findUnique.mockResolvedValue({ tipoAsistente: 'agenda' });
    await expect(service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' })).rejects.toMatchObject({
      status: 409,
    });

    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });
    await expect(service.generate('user-1', dto)).rejects.toMatchObject({ status: 409 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('un asistente de ventas no tiene reuniones para editar (409)', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ ...agenteGuardado, tipoAsistente: 'ventas' });

    await expect(
      service.actualizarTiposEvento('user-1', [{ nombre: 'Consulta', duracionMin: 30 }]),
    ).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
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
