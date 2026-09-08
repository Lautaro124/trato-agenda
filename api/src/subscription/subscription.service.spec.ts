import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MercadoPagoClient, Preapproval } from './mercadopago.client.js';
import { SubscriptionService } from './subscription.service.js';
import { DIAS_PRUEBA } from './subscription.rules.js';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Base de datos en memoria: una sola fila Subscription, indexada por userId. */
function crearServicio(opciones: {
  creadoHaceDias: number;
  suscripcion?: { estado: string } | null;
  preapproval?: Partial<Preapproval>;
}) {
  const filas = new Map<string, Record<string, unknown>>();
  if (opciones.suscripcion) {
    filas.set('user-1', { userId: 'user-1', montoCentavos: 2_000_000, moneda: 'ARS', ...opciones.suscripcion });
  }

  const prisma = {
    user: {
      findUnique: vi.fn().mockImplementation(() => ({
        id: 'user-1',
        email: 'dueño@ejemplo.com',
        createdAt: new Date(Date.now() - opciones.creadoHaceDias * MS_POR_DIA),
        suscripcion: filas.get('user-1') ?? null,
      })),
    },
    subscription: {
      findUnique: vi.fn().mockImplementation(() => filas.get('user-1') ?? null),
      upsert: vi.fn().mockImplementation(({ where, create, update }: Record<string, never>) => {
        const previa = filas.get((where as { userId: string }).userId);
        const fila = previa ? { ...previa, ...(update as object) } : { ...(create as object) };
        filas.set((where as { userId: string }).userId, fila as Record<string, unknown>);
        return fila;
      }),
      update: vi.fn().mockImplementation(({ where, data }: Record<string, never>) => {
        const fila = { ...filas.get((where as { userId: string }).userId), ...(data as object) };
        filas.set((where as { userId: string }).userId, fila as Record<string, unknown>);
        return fila;
      }),
    },
  } as unknown as PrismaService;

  const mercadoPago = {
    crearPreapproval: vi.fn().mockResolvedValue({
      id: 'pre-1',
      status: 'pending',
      init_point: 'https://mp/checkout',
      ...opciones.preapproval,
    }),
    obtenerPreapproval: vi.fn().mockResolvedValue({
      id: 'pre-1',
      status: 'authorized',
      external_reference: 'user-1',
      next_payment_date: '2026-10-08T12:00:00.000Z',
      ...opciones.preapproval,
    }),
    cancelarPreapproval: vi.fn().mockResolvedValue({ id: 'pre-1', status: 'cancelled' }),
  } as unknown as MercadoPagoClient;

  const config = {
    get: (clave: string) =>
      clave === 'SUSCRIPCION_PRECIO_ARS' ? 20000 : 'http://localhost:3000',
  } as unknown as ConfigService<Env, true>;

  return { service: new SubscriptionService(prisma, mercadoPago, config), prisma, mercadoPago, filas };
}

const USUARIO = { id: 'user-1', email: 'dueño@ejemplo.com' } as User;

describe('SubscriptionService', () => {
  it('el checkout guarda el preapproval y devuelve el init_point', async () => {
    const { service, mercadoPago, filas } = crearServicio({ creadoHaceDias: 2 });

    const { initPoint } = await service.crearCheckout(USUARIO);

    expect(initPoint).toBe('https://mp/checkout');
    expect(vi.mocked(mercadoPago.crearPreapproval).mock.calls[0][0]).toMatchObject({
      externalReference: 'user-1',
      backUrl: 'http://localhost:3000/plan?volviendo=1',
      montoPorMes: 20000,
    });
    expect(filas.get('user-1')).toMatchObject({ mpPreapprovalId: 'pre-1', estado: 'pendiente', montoCentavos: 2_000_000 });
  });

  it('el webhook nunca lee el estado del payload: lo vuelve a pedir a Mercado Pago', async () => {
    const { service, mercadoPago, filas } = crearServicio({ creadoHaceDias: 2 });

    await service.sincronizarDesdeMp('pre-1');

    expect(mercadoPago.obtenerPreapproval).toHaveBeenCalledWith('pre-1');
    expect(filas.get('user-1')).toMatchObject({ estado: 'activa', mpStatus: 'authorized' });
  });

  it('el mismo webhook aplicado dos veces deja una sola fila', async () => {
    const { service, prisma, filas } = crearServicio({ creadoHaceDias: 2 });

    await service.sincronizarDesdeMp('pre-1');
    await service.sincronizarDesdeMp('pre-1');

    expect(filas.size).toBe(1);
    expect(vi.mocked(prisma.subscription.upsert)).toHaveBeenCalledTimes(2);
  });

  it('un preapproval sin external_reference se ignora en vez de crear filas huérfanas', async () => {
    const { service, filas } = crearServicio({
      creadoHaceDias: 2,
      preapproval: { external_reference: undefined },
    });

    await service.sincronizarDesdeMp('pre-1');

    expect(filas.size).toBe(0);
  });

  it('asistenteActivo sigue las reglas de la prueba', async () => {
    const enPrueba = crearServicio({ creadoHaceDias: 2 });
    const vencido = crearServicio({ creadoHaceDias: DIAS_PRUEBA + 1 });
    const pagando = crearServicio({ creadoHaceDias: DIAS_PRUEBA + 1, suscripcion: { estado: 'activa' } });

    expect(await enPrueba.service.asistenteActivo('user-1')).toBe(true);
    expect(await vencido.service.asistenteActivo('user-1')).toBe(false);
    expect(await pagando.service.asistenteActivo('user-1')).toBe(true);
  });

  it('cancelar avisa a Mercado Pago y marca la fila', async () => {
    const { service, mercadoPago, filas } = crearServicio({
      creadoHaceDias: 2,
      suscripcion: { estado: 'activa' },
    });
    filas.set('user-1', { ...filas.get('user-1'), mpPreapprovalId: 'pre-1' } as Record<string, unknown>);

    const publica = await service.cancelar('user-1');

    expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-1');
    expect(filas.get('user-1')).toMatchObject({ estado: 'cancelada' });
    expect(publica.estado).toBe('prueba');
  });
});
