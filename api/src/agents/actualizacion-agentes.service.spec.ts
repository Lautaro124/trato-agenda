import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PLANTILLA_VENTAS_VERSION } from './agent-template-ventas.js';
import { ActualizacionAgentesService, lineaDeLog } from './actualizacion-agentes.service.js';

const fecha = new Date('2026-10-01T12:00:00Z');

const base = {
  tipoTitular: 'negocio',
  nombreTitular: 'Mates del Sur',
  tipoUso: 'comercio',
  tiposEvento: [],
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreBot: 'Sol',
  updatedAt: fecha,
};

const AGENTES = [
  { ...base, id: 'viejo', tipoAsistente: 'ventas', model: null, templateVersion: 2 },
  { ...base, id: 'nuevo', tipoAsistente: 'ventas', model: null, templateVersion: PLANTILLA_VENTAS_VERSION },
  { ...base, id: 'roto', tipoAsistente: 'agenda', model: 'x', templateVersion: null, tiposEvento: [] },
];

function crearPrisma(opciones: { editadoEnElMedio?: boolean } = {}) {
  return {
    agent: {
      findMany: vi.fn().mockResolvedValue(AGENTES),
      updateMany: vi.fn().mockResolvedValue({ count: opciones.editadoEnElMedio ? 0 : 1 }),
    },
    user: { count: vi.fn(async (args?: { where?: unknown }) => (args?.where ? 2 : 5)) },
  };
}

describe('ActualizacionAgentesService', () => {
  it('regenera sólo los que no están al día, sin pisar una edición del dueño, y cuenta los usuarios', async () => {
    const prisma = crearPrisma();
    const servicio = new ActualizacionAgentesService(prisma as unknown as PrismaService);

    const resultado = await servicio.actualizar();

    expect(prisma.agent.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.agent.updateMany).toHaveBeenCalledWith({
      where: { id: 'viejo', updatedAt: fecha },
      data: expect.objectContaining({ templateVersion: PLANTILLA_VENTAS_VERSION, model: null }),
    });
    expect(resultado).toEqual({
      regenerados: 1,
      alDia: 1,
      sinDatos: 1,
      usuarios: { total: 5, conAsistente: 3, agenda: 1, ventas: 2, conWhatsapp: 2 },
    });
  });

  it('si el dueño lo editó en el medio, no lo cuenta como regenerado', async () => {
    const servicio = new ActualizacionAgentesService(crearPrisma({ editadoEnElMedio: true }) as unknown as PrismaService);
    expect((await servicio.actualizar()).regenerados).toBe(0);
  });

  it('un error no rompe el arranque: queda en el log', async () => {
    const prisma = { agent: { findMany: vi.fn().mockRejectedValue(new Error('base caída')) } };
    const servicio = new ActualizacionAgentesService(prisma as unknown as PrismaService);
    const error = vi.spyOn((servicio as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => {});

    expect(() => servicio.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('No se pudieron actualizar los agentes: base caída'));
  });
});

describe('lineaDeLog', () => {
  it('sólo números, sin nombres ni ids', () => {
    expect(
      lineaDeLog({
        regenerados: 1,
        alDia: 2,
        sinDatos: 0,
        usuarios: { total: 7, conAsistente: 3, agenda: 2, ventas: 1, conWhatsapp: 4 },
      }),
    ).toBe(
      'Agentes: 1 regenerados, 2 al día, 0 sin datos para regenerar. ' +
        'Usuarios: 7 (3 con asistente: 2 de agenda, 1 de ventas; 4 con WhatsApp vinculado).',
    );
  });
});
