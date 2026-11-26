import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CANAL_POR_DEFECTO, CanalesWhatsapp } from './canales.service.js';

function crear(fila: Record<string, unknown> | null = null) {
  let generacion = (fila?.generacion as number | undefined) ?? 0;
  const prisma = {
    canalWhatsapp: {
      findUnique: vi.fn().mockResolvedValue(fila),
      upsert: vi.fn().mockImplementation(({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        generacion += 1;
        const datos = { ...create, ...update };
        return Promise.resolve({
          proveedor: (datos.proveedor as string | undefined) ?? 'baileys',
          automatizacionPausada: (datos.automatizacionPausada as boolean | undefined) ?? false,
          generacion,
          ultimoFallo: (datos.ultimoFallo as string | undefined) ?? null,
        });
      }),
      update: vi.fn().mockResolvedValue({ proveedor: 'baileys', automatizacionPausada: false, generacion, ultimoFallo: null }),
    },
  } as unknown as PrismaService;
  return { canales: new CanalesWhatsapp(prisma), prisma };
}

describe('CanalesWhatsapp', () => {
  it('una cuenta sin fila usa Baileys, sin pausa, en la generación 0', async () => {
    const { canales } = crear();
    expect(await canales.estado('user-1')).toEqual(CANAL_POR_DEFECTO);
    expect(canales.vigente('user-1', 'baileys', 0)).toBe(true);
  });

  it('lee la base una sola vez aunque la pidan varios a la vez', async () => {
    const { canales, prisma } = crear();
    await Promise.all([canales.estado('user-1'), canales.estado('user-1'), canales.estado('user-1')]);
    await canales.estado('user-1');
    expect(prisma.canalWhatsapp.findUnique).toHaveBeenCalledOnce();
  });

  it('si la base falla, atiende como una cuenta sin fila', async () => {
    const { canales, prisma } = crear();
    vi.mocked(prisma.canalWhatsapp.findUnique).mockRejectedValue(new Error('sin conexión'));
    expect(await canales.estado('user-1')).toEqual(CANAL_POR_DEFECTO);
  });

  it('un proveedor desconocido en la base no se inventa: queda Baileys', async () => {
    const { canales } = crear({ proveedor: 'otro', automatizacionPausada: false, generacion: 4, ultimoFallo: 'algo' });
    expect(await canales.estado('user-1')).toEqual({ ...CANAL_POR_DEFECTO, generacion: 4 });
  });

  it('pausar y reanudar suben la generación: lo armado antes deja de estar vigente', async () => {
    const { canales } = crear();
    await canales.estado('user-1');

    const pausado = await canales.pausar('user-1', true);
    expect(pausado).toMatchObject({ automatizacionPausada: true, generacion: 1 });
    expect(canales.vigente('user-1', 'baileys', 0)).toBe(false);

    const reanudado = await canales.pausar('user-1', false);
    expect(reanudado).toMatchObject({ automatizacionPausada: false, generacion: 2 });
    expect(canales.vigente('user-1', 'baileys', 1)).toBe(false);
    expect(canales.vigente('user-1', 'baileys', 2)).toBe(true);
  });

  it('una lectura que termina después de un cambio no lo pisa', async () => {
    const { canales, prisma } = crear();
    let devolver!: (fila: null) => void;
    vi.mocked(prisma.canalWhatsapp.findUnique).mockReturnValue(new Promise((resolve) => (devolver = resolve)) as never);

    const lectura = canales.estado('user-1');
    await canales.pausar('user-1', true);
    devolver(null);

    expect(await lectura).toMatchObject({ automatizacionPausada: true, generacion: 1 });
    expect((await canales.estado('user-1')).automatizacionPausada).toBe(true);
  });

  it('dos cambios que terminan al revés: queda el de generación más alta', async () => {
    const { canales, prisma } = crear();
    const filas = [
      { proveedor: 'baileys', automatizacionPausada: true, generacion: 2, ultimoFallo: null },
      { proveedor: 'baileys', automatizacionPausada: false, generacion: 1, ultimoFallo: null },
    ];
    vi.mocked(prisma.canalWhatsapp.upsert).mockImplementation((() => Promise.resolve(filas.shift())) as never);

    await canales.pausar('user-1', true);
    await canales.pausar('user-1', false);

    expect(await canales.estado('user-1')).toMatchObject({ automatizacionPausada: true, generacion: 2 });
  });

  it('cambiar de proveedor sube la generación y limpia el fallo', async () => {
    const { canales, prisma } = crear();
    await canales.cambiarProveedor('user-1', 'baileys');
    expect(prisma.canalWhatsapp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { proveedor: 'baileys', generacion: { increment: 1 }, ultimoFallo: null, ultimoFalloAt: null },
      }),
    );
    expect(canales.vigente('user-1', 'baileys', 1)).toBe(true);
  });

  it('el fallo se escribe una vez, y recuperarse sin fallo previo no toca la base', async () => {
    const { canales, prisma } = crear();

    await canales.registrarFallo('user-1', 'baileys', null);
    expect(prisma.canalWhatsapp.update).not.toHaveBeenCalled();
    expect(prisma.canalWhatsapp.upsert).not.toHaveBeenCalled();

    await canales.registrarFallo('user-1', 'baileys', 'sin_conexion');
    await canales.registrarFallo('user-1', 'baileys', 'sin_conexion');
    expect(prisma.canalWhatsapp.upsert).toHaveBeenCalledOnce();
    expect((await canales.estado('user-1')).fallo).toBe('sin_conexion');

    await canales.registrarFallo('user-1', 'baileys', null);
    expect(prisma.canalWhatsapp.update).toHaveBeenCalledOnce();
  });

  it('si la base falla al registrar el fallo, no rompe nada', async () => {
    const { canales, prisma } = crear();
    vi.mocked(prisma.canalWhatsapp.upsert).mockRejectedValue(new Error('sin conexión'));
    await expect(canales.registrarFallo('user-1', 'baileys', 'volver_a_vincular')).resolves.toBeUndefined();
  });
});
