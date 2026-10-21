import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MercadoPagoClient, Preapproval } from './mercadopago.client.js';
import { SubscriptionService } from './subscription.service.js';
import { DIAS_PRUEBA } from './subscription.rules.js';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Base de datos en memoria: una sola fila Subscription, indexada por userId. */
function crearServicio(opciones: {
  creadoHaceDias: number;
  /** Alta de una cuenta anterior de la misma identidad, ya borrada. */
  lapidaHaceDias?: number;
  suscripcion?: { estado: string } | null;
  preapproval?: Partial<Preapproval>;
  emailsTomados?: string[];
  /** Clientes distintos del mes que devuelve el conteo. */
  chatsDelMes?: number;
  /** Claves de avisos de cupo ya guardados. */
  avisosPrevios?: string[];
}) {
  const filas = new Map<string, Record<string, unknown>>();
  if (opciones.suscripcion) {
    filas.set('user-1', { userId: 'user-1', montoCentavos: 2_000_000, moneda: 'ARS', ...opciones.suscripcion });
  }

  const prisma = {
    user: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email !== undefined) {
          return opciones.emailsTomados?.includes(where.email) ? { id: 'otro' } : null;
        }
        return {
          id: 'user-1',
          email: 'dueño@ejemplo.com',
          googleId: 'google-1',
          createdAt: new Date(Date.now() - opciones.creadoHaceDias * MS_POR_DIA),
          suscripcion: filas.get('user-1') ?? null,
        };
      }),
    },
    pruebaConsumida: {
      findMany: vi.fn().mockResolvedValue(
        opciones.lapidaHaceDias === undefined
          ? []
          : [{ inicio: new Date(Date.now() - opciones.lapidaHaceDias * MS_POR_DIA) }],
      ),
    },
    notificacion: {
      findFirst: vi
        .fn()
        .mockImplementation(({ where }: { where: { clave: string } }) =>
          opciones.avisosPrevios?.includes(where.clave) ? { id: 'n-1' } : null,
        ),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ chats: BigInt(opciones.chatsDelMes ?? 0) }]),
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
      clave === 'SUSCRIPCION_PRECIO_ARS' ? 20000 : clave === 'SUSCRIPCION_PRECIO_PRO_ARS' ? 59000 : 'http://localhost:3000',
  } as unknown as ConfigService<Env, true>;
  const notificaciones = { avisar: vi.fn().mockResolvedValue(null) } as unknown as NotificacionesService;

  return {
    service: new SubscriptionService(prisma, mercadoPago, config, notificaciones),
    prisma,
    mercadoPago,
    notificaciones,
    filas,
  };
}

const USUARIO = { id: 'user-1', email: 'dueño@ejemplo.com' } as User;

describe('SubscriptionService', () => {
  it('el checkout guarda el preapproval y devuelve el init_point', async () => {
    const { service, mercadoPago, filas } = crearServicio({ creadoHaceDias: 2 });

    const { initPoint } = await service.crearCheckout(USUARIO, 'basico');

    expect(initPoint).toBe('https://mp/checkout');
    expect(vi.mocked(mercadoPago.crearPreapproval).mock.calls[0][0]).toMatchObject({
      externalReference: 'user-1',
      backUrl: 'http://localhost:3000/plan?volviendo=1',
      montoPorMes: 20000,
    });
    expect(filas.get('user-1')).toMatchObject({
      mpPreapprovalId: 'pre-1',
      estado: 'pendiente',
      plan: 'basico',
      montoCentavos: 2_000_000,
    });
  });

  it('una cuenta sin email (alta por WhatsApp) tiene que mandarlo y queda guardado', async () => {
    const { service, prisma, mercadoPago } = crearServicio({ creadoHaceDias: 2 });
    const sinEmail = { ...USUARIO, email: null };

    await expect(service.crearCheckout(sinEmail, 'basico')).rejects.toThrow('Falta el email');

    await service.crearCheckout(sinEmail, 'basico', 'nuevo@ejemplo.com');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { email: 'nuevo@ejemplo.com' } });
    expect(vi.mocked(mercadoPago.crearPreapproval).mock.calls[0][0]).toMatchObject({ payerEmail: 'nuevo@ejemplo.com' });
  });

  it('no deja usar para pagar el email de otra cuenta', async () => {
    const { service, mercadoPago } = crearServicio({ creadoHaceDias: 2, emailsTomados: ['ajeno@ejemplo.com'] });

    await expect(service.crearCheckout({ ...USUARIO, email: null }, 'basico', 'ajeno@ejemplo.com')).rejects.toThrow('otra cuenta');
    expect(mercadoPago.crearPreapproval).not.toHaveBeenCalled();
  });

  it('con email propio ignora el que venga en el body', async () => {
    const { service, prisma, mercadoPago } = crearServicio({ creadoHaceDias: 2 });

    await service.crearCheckout(USUARIO, 'basico', 'otro@ejemplo.com');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(vi.mocked(mercadoPago.crearPreapproval).mock.calls[0][0]).toMatchObject({ payerEmail: 'dueño@ejemplo.com' });
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

  it('una cuenta recreada hereda la prueba de la que se borró', async () => {
    // Se dio de alta hace 31 días, borró la cuenta y volvió hoy: ya no tiene prueba.
    const recreada = crearServicio({ creadoHaceDias: 0, lapidaHaceDias: DIAS_PRUEBA + 1 });
    expect(await recreada.service.asistenteActivo('user-1')).toBe(false);

    // Borró a los 29 días: le queda 1.
    const aTiempo = crearServicio({ creadoHaceDias: 0, lapidaHaceDias: 29 });
    expect(await aTiempo.service.asistenteActivo('user-1')).toBe(true);
    expect((await aTiempo.service.estadoPublico('user-1')).diasRestantes).toBe(1);
  });

  it('el checkout del Pro cobra el precio del Pro y lo guarda en la fila', async () => {
    const { service, mercadoPago, filas } = crearServicio({ creadoHaceDias: 2 });

    await service.crearCheckout(USUARIO, 'pro');

    expect(vi.mocked(mercadoPago.crearPreapproval).mock.calls[0][0]).toMatchObject({
      montoPorMes: 59000,
      reason: 'Trato — plan Pro',
    });
    expect(filas.get('user-1')).toMatchObject({ plan: 'pro', montoCentavos: 5_900_000 });
  });

  describe('cambio de plan con una suscripción activa', () => {
    function pagandoBasico() {
      const ctx = crearServicio({ creadoHaceDias: 40, suscripcion: { estado: 'activa' } });
      ctx.filas.set('user-1', { ...ctx.filas.get('user-1'), mpPreapprovalId: 'pre-viejo', plan: 'basico' } as Record<string, unknown>);
      return ctx;
    }

    it('el checkout no toca la suscripción vigente ni cancela nada: deja el nuevo pendiente', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();

      await service.crearCheckout(USUARIO, 'pro');

      expect(mercadoPago.cancelarPreapproval).not.toHaveBeenCalled();
      expect(filas.get('user-1')).toMatchObject({
        estado: 'activa',
        plan: 'basico',
        mpPreapprovalId: 'pre-viejo',
        mpPreapprovalPendienteId: 'pre-1',
        planPendiente: 'pro',
      });
    });

    it('repetir el checkout cancela el pendiente abandonado, para que no cobre dos veces', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();
      filas.set('user-1', { ...filas.get('user-1'), mpPreapprovalPendienteId: 'pre-abandonado', planPendiente: 'pro' } as Record<string, unknown>);

      await service.crearCheckout(USUARIO, 'pro');

      expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-abandonado');
      expect(filas.get('user-1')).toMatchObject({ mpPreapprovalPendienteId: 'pre-1' });
    });

    it('un preapproval autorizado que no es el vigente ni el pendiente se cancela', async () => {
      const { service, mercadoPago } = pagandoBasico();

      await service.sincronizarDesdeMp('pre-1');

      expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-1');
    });

    it('cancelar baja también el cambio de plan pendiente', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();
      filas.set('user-1', { ...filas.get('user-1'), mpPreapprovalPendienteId: 'pre-pend', planPendiente: 'pro' } as Record<string, unknown>);

      await service.cancelar('user-1');

      expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-viejo');
      expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-pend');
      expect(filas.get('user-1')).toMatchObject({ estado: 'cancelada', mpPreapprovalPendienteId: null, planPendiente: null });
    });

    it('cuando el nuevo se autoriza, se adopta con su plan y se cancela el anterior', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();
      await service.crearCheckout(USUARIO, 'pro');

      await service.sincronizarDesdeMp('pre-1');

      expect(mercadoPago.cancelarPreapproval).toHaveBeenCalledWith('pre-viejo');
      expect(filas.get('user-1')).toMatchObject({
        estado: 'activa',
        plan: 'pro',
        mpPreapprovalId: 'pre-1',
        montoCentavos: 5_900_000,
        mpPreapprovalPendienteId: null,
        planPendiente: null,
      });
    });

    it('si abandona el pago del nuevo, sigue con el plan que tenía', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();
      await service.crearCheckout(USUARIO, 'pro');
      vi.mocked(mercadoPago.obtenerPreapproval).mockResolvedValueOnce({
        id: 'pre-1',
        status: 'cancelled',
        external_reference: 'user-1',
      } as Preapproval);

      await service.sincronizarDesdeMp('pre-1');

      expect(filas.get('user-1')).toMatchObject({ estado: 'activa', plan: 'basico', mpPreapprovalId: 'pre-viejo', planPendiente: null });
    });

    it('el webhook "cancelled" del preapproval viejo no pisa al nuevo', async () => {
      const { service, mercadoPago, filas } = pagandoBasico();
      filas.set('user-1', { ...filas.get('user-1'), mpPreapprovalId: 'pre-nuevo', plan: 'pro' } as Record<string, unknown>);
      vi.mocked(mercadoPago.obtenerPreapproval).mockResolvedValueOnce({
        id: 'pre-viejo',
        status: 'cancelled',
        external_reference: 'user-1',
      } as Preapproval);

      await service.sincronizarDesdeMp('pre-viejo');

      expect(filas.get('user-1')).toMatchObject({ estado: 'activa', mpPreapprovalId: 'pre-nuevo', plan: 'pro' });
    });
  });

  it('el precio público lista los dos planes con su tope de chats', () => {
    const { service } = crearServicio({ creadoHaceDias: 2 });

    expect(service.precioPublico()).toEqual({
      moneda: 'ARS',
      planes: [
        { id: 'basico', nombre: 'Básico', chats: 1500, monto: 20000 },
        { id: 'pro', nombre: 'Pro', chats: 4500, monto: 59000 },
      ],
    });
  });

  it('el estado público trae el uso del mes contra el tope del plan', async () => {
    const pagandoPro = crearServicio({ creadoHaceDias: 40, suscripcion: { estado: 'activa' }, chatsDelMes: 3100 });
    pagandoPro.filas.set('user-1', { ...pagandoPro.filas.get('user-1'), plan: 'pro' } as Record<string, unknown>);
    const enPrueba = crearServicio({ creadoHaceDias: 2, chatsDelMes: 12 });

    expect((await pagandoPro.service.estadoPublico('user-1'))).toMatchObject({ plan: 'pro', uso: { chats: 3100, limite: 4500 } });
    expect((await enPrueba.service.estadoPublico('user-1'))).toMatchObject({ plan: null, uso: { chats: 12, limite: 4500 } });
  });

  describe('avisarSiLlegaAlTope', () => {
    const AHORA = new Date('2026-10-19T15:00:00.000Z');

    function pagando(plan: string, chats: number, avisosPrevios: string[] = []) {
      const ctx = crearServicio({ creadoHaceDias: 60, suscripcion: { estado: 'activa' }, chatsDelMes: chats, avisosPrevios });
      ctx.filas.set('user-1', { ...ctx.filas.get('user-1'), plan } as Record<string, unknown>);
      return ctx;
    }

    it('por debajo del 80 % no avisa', async () => {
      const { service, notificaciones } = pagando('basico', 1199);
      await service.avisarSiLlegaAlTope('user-1', AHORA);
      expect(notificaciones.avisar).not.toHaveBeenCalled();
    });

    it('al 80 % avisa, una sola vez en el mes aunque ya lo haya leído', async () => {
      const primera = pagando('basico', 1200);
      await primera.service.avisarSiLlegaAlTope('user-1', AHORA);
      expect(primera.notificaciones.avisar).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ tipo: 'cupo_chats', clave: 'cupo_chats:80:2026-10' }),
      );

      const repetida = pagando('basico', 1300, ['cupo_chats:80:2026-10']);
      await repetida.service.avisarSiLlegaAlTope('user-1', AHORA);
      expect(repetida.notificaciones.avisar).not.toHaveBeenCalled();
    });

    it('al tope avisa con otra clave, y el Pro tiene 4.500', async () => {
      const basico = pagando('basico', 1500);
      await basico.service.avisarSiLlegaAlTope('user-1', AHORA);
      expect(basico.notificaciones.avisar).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ clave: 'cupo_chats:100:2026-10' }),
      );

      const pro = pagando('pro', 2500);
      await pro.service.avisarSiLlegaAlTope('user-1', AHORA);
      expect(pro.notificaciones.avisar).not.toHaveBeenCalled();
    });
  });

  it('una fila pendiente con un precio viejo muestra el de env, que es el que va a cobrar el checkout', async () => {
    const { service, filas } = crearServicio({ creadoHaceDias: 2, suscripcion: { estado: 'pendiente' } });
    filas.set('user-1', { ...filas.get('user-1'), montoCentavos: 1_500_000 } as Record<string, unknown>);

    expect((await service.estadoPublico('user-1')).monto).toBe(20000);
  });

  it('una suscripción activa muestra lo que efectivamente paga', async () => {
    const { service, filas } = crearServicio({ creadoHaceDias: 2, suscripcion: { estado: 'activa' } });
    filas.set('user-1', { ...filas.get('user-1'), montoCentavos: 1_500_000 } as Record<string, unknown>);

    expect((await service.estadoPublico('user-1')).monto).toBe(15000);
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
