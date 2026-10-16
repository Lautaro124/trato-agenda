import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LinearError, type LinearClient } from './linear.client.js';
import { MAX_INTENTOS, MejorasService } from './mejoras.service.js';

const TEXTO = 'Me gustaría recordatorios el día antes del turno';

function armar(opciones: { configurado?: boolean; crearIssue?: () => Promise<string> } = {}) {
  const fila = { id: 's1', userId: 'u1', tipo: 'idea', texto: TEXTO, intentos: 0 };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    sugerenciaMejora: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 's1' }),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    sugerenciaMejora: {
      findFirst: vi.fn().mockResolvedValue(fila),
      findMany: vi.fn().mockResolvedValue([{ id: 's1' }]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const linear = {
    configurado: () => opciones.configurado ?? true,
    crearIssue: vi.fn(opciones.crearIssue ?? (() => Promise.resolve('LAU-99'))),
  };
  const servicio = new MejorasService(prisma as unknown as PrismaService, linear as unknown as LinearClient);
  return { servicio, prisma, tx, linear, fila };
}

describe('MejorasService', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('valida antes de tocar la base', async () => {
    const { servicio, prisma } = armar();
    await expect(servicio.crear('u1', 'idea', 'Miren <script>alert(1)</script> esto')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(servicio.crear('u1', 'malo' as 'idea', TEXTO)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('guarda el texto normalizado y lo manda a Linear sin el teléfono ni el mail', async () => {
    const { servicio, tx, linear, prisma } = armar();
    await servicio.crear('u1', 'idea', `  ${TEXTO}  `);
    await servicio.esperar();

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.sugerenciaMejora.create).toHaveBeenCalledWith({
      data: { userId: 'u1', tipo: 'idea', texto: TEXTO },
      select: { id: true },
    });
    expect(linear.crearIssue).toHaveBeenCalledWith({
      titulo: `Sugerencia · Idea: ${TEXTO.slice(0, 60)}`,
      descripcion: `${TEXTO}\n\n---\nTipo: Idea · Cuenta: u1`,
    });
    expect(prisma.sugerenciaMejora.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { linearIssueId: 'LAU-99', enviadaAt: expect.any(Date) },
    });
  });

  it('con el tope diario cumplido responde 429 y no guarda', async () => {
    const { servicio, tx } = armar();
    tx.sugerenciaMejora.count.mockResolvedValue(5);
    await expect(servicio.crear('u1', 'idea', TEXTO)).rejects.toMatchObject({ status: 429 });
    expect(tx.sugerenciaMejora.create).not.toHaveBeenCalled();
  });

  it('si Linear falla, queda pendiente con un intento más y el log no lleva el texto', async () => {
    const { servicio, prisma } = armar({ crearIssue: () => Promise.reject(new LinearError('Linear respondió 500.')) });
    await servicio.crear('u1', 'problema', TEXTO);
    await servicio.esperar();

    expect(prisma.sugerenciaMejora.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', enviadaAt: null, intentos: 0 },
      data: { intentos: 1 },
    });
    expect(prisma.sugerenciaMejora.update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logs = [...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(logs).toContain('s1');
    expect(logs).not.toContain('recordatorios');
  });

  it('al último intento lo reporta como error para que llegue a Sentry', async () => {
    const { servicio, fila } = armar({ crearIssue: () => Promise.reject(new LinearError('x')) });
    fila.intentos = MAX_INTENTOS - 1;
    await servicio.enviar('s1');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('si el issue se creó pero no se pudo marcar, lo deja en el log con el identificador', async () => {
    const { servicio, prisma } = armar();
    prisma.sugerenciaMejora.update.mockRejectedValueOnce(new Error('db caída'));
    await servicio.enviar('s1');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('LAU-99');
  });

  it('si otro envío ya la reservó, no llama a Linear (no la duplica)', async () => {
    const { servicio, prisma, linear } = armar();
    prisma.sugerenciaMejora.updateMany.mockResolvedValue({ count: 0 });
    await servicio.enviar('s1');
    expect(linear.crearIssue).not.toHaveBeenCalled();
  });

  it('un error de la base al enviar no queda como promesa rechazada suelta', async () => {
    const { servicio, prisma } = armar();
    prisma.sugerenciaMejora.findFirst.mockRejectedValue(new Error('db caída'));
    await servicio.crear('u1', 'idea', TEXTO);
    await expect(servicio.esperar()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('sin Linear configurado guarda igual y no intenta mandarla', async () => {
    const { servicio, tx, linear } = armar({ configurado: false });
    await servicio.crear('u1', 'otro', TEXTO);
    await servicio.esperar();
    expect(tx.sugerenciaMejora.create).toHaveBeenCalled();
    expect(linear.crearIssue).not.toHaveBeenCalled();
  });

  it('el barrido reintenta las pendientes viejas', async () => {
    const { servicio, prisma, linear } = armar();
    await servicio.barrer();
    expect(prisma.sugerenciaMejora.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enviadaAt: null, intentos: { lt: MAX_INTENTOS }, createdAt: { lt: expect.any(Date) } },
      }),
    );
    expect(linear.crearIssue).toHaveBeenCalledTimes(1);
  });
});
