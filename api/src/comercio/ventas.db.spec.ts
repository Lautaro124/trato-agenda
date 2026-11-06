/**
 * Pedidos contra Postgres real: la reserva con FOR UPDATE, el descuento de
 * stock y la idempotencia del pago son SQL que un mock no prueba. Ver
 * test/base-de-prueba.ts.
 */
import { RegistroPerformanceService } from '../performance/registro.service.js';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import type { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';
import {
  MercadoPagoError,
  MercadoPagoNoAutorizadoError,
  type MercadoPagoClient,
} from '../subscription/mercadopago.client.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { CuotasProducto } from './condiciones-pago.rules.js';
import type { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { enAtencionHumana, MAX_PEDIDOS_PENDIENTES } from './ventas.rules.js';
import { PedidoRechazadoError, VentasService } from './ventas.service.js';

const config = { get: (clave: string) => (clave === 'API_PUBLIC_URL' ? 'https://api.test' : '') } as unknown as ConfigService<
  Env,
  true
>;

describe.skipIf(!hayBaseDePrueba)('pedidos y ventas (Postgres real)', () => {
  let prisma: PrismaService;
  let dueno: User;
  let mate: string;
  let termo: string;
  let sinControl: string;
  let conversationId: string;
  const mp = {
    crearPreferencia: vi.fn(),
    buscarPagos: vi.fn(),
    obtenerPago: vi.fn(),
  };
  const cuentas = { tokenDe: vi.fn(), desconectar: vi.fn() };
  const notificaciones = { avisar: vi.fn(), avisarAlCliente: vi.fn() };
  const suscripcion = { asistenteActivo: vi.fn() };
  const horario = { puedeEscribir: vi.fn() };
  const avisosDeTipo = (tipo: string) =>
    notificaciones.avisar.mock.calls.filter(([, aviso]) => (aviso as { tipo: string }).tipo === tipo);
  let ventas: VentasService;

  const pedido = (items: Array<{ productoId: string; cantidad: number }>, extra: Record<string, unknown> = {}) =>
    ventas.crearPedido({
      userId: dueno.id,
      conversationId: null,
      remoteJid: '5491122334455@s.whatsapp.net',
      nombreCliente: 'Juan',
      items,
      medioPago: 'manual',
      ...extra,
    });

  const stockDe = async (productoId: string) =>
    (await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).stock;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    ventas = new VentasService(
      prisma,
      mp as unknown as MercadoPagoClient,
      cuentas as unknown as CuentaMercadoPagoService,
      config,
      notificaciones as unknown as NotificacionesService,
      new RegistroPerformanceService(prisma),
      suscripcion as unknown as SubscriptionService,
      horario as unknown as HorarioAtencionService,
    );
    dueno = await crearUsuarioDePrueba(prisma);
    const crear = (codigo: string, precioCentavos: number, stock: number | null, stockMinimo: number | null = null) =>
      prisma.producto.create({
        data: {
          userId: dueno.id,
          codigo,
          nombre: `Producto ${codigo}`,
          precioCentavos,
          stock,
          stockMinimo,
        },
      });
    mate = (await crear('MATE', 800_000, 1)).id;
    termo = (await crear('TERMO', 4_500_050, 5, 3)).id;
    sinControl = (await crear('BOMBILLA', 350_000, null)).id;
    conversationId = (await prisma.conversation.create({ data: { userId: dueno.id, remoteJid: '5491122334455@s.whatsapp.net' } })).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: dueno.id } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    await prisma.venta.deleteMany({ where: { userId: dueno.id } });
    await prisma.descuento.deleteMany({ where: { userId: dueno.id } });
    await prisma.condicionesPago.deleteMany({ where: { userId: dueno.id } });
    await prisma.producto.updateMany({ where: { userId: dueno.id }, data: { cuotas: Prisma.DbNull } });
    await prisma.producto.update({ where: { id: mate }, data: { stock: 1 } });
    await prisma.producto.update({ where: { id: termo }, data: { stock: 5 } });
  });

  it('crea el pedido con la foto de los productos, el total y la reserva', async () => {
    const venta = await pedido([
      { productoId: termo, cantidad: 2 },
      { productoId: sinControl, cantidad: 1 },
      { productoId: termo, cantidad: 1 },
    ]);
    expect(venta).toMatchObject({
      estado: 'pendiente_pago',
      medioPago: 'manual',
      nombreCliente: 'Juan',
      telefonoCliente: '5491122334455',
      totalCentavos: 3 * 4_500_050 + 350_000,
    });
    expect(venta.items.find((item) => item.productoId === termo)).toMatchObject({
      codigo: 'TERMO',
      cantidad: 3,
      precioUnitarioCentavos: 4_500_050,
    });
    // Un pedido a cobrar a mano le llega al dueño.
    expect(avisosDeTipo('pedido_manual')).toEqual([[dueno.id, expect.objectContaining({ enlace: `/ventas?venta=${venta.id}` })]]);
    // Reservar no descuenta stock: eso pasa recién al pagar.
    expect(await stockDe(termo)).toBe(5);
    expect(await ventas.reservadasPorProducto([termo])).toEqual(new Map([[termo, 3]]));
  });

  it('guarda la entrega y los datos del cliente; sin datos la columna queda vacía', async () => {
    const conDatos = await pedido([{ productoId: sinControl, cantidad: 1 }], {
      entrega: 'envio',
      datosCliente: [{ etiqueta: 'Código postal', valor: '1414' }],
    });
    const sinDatos = await pedido([{ productoId: sinControl, cantidad: 1 }]);
    expect(await prisma.venta.findUniqueOrThrow({ where: { id: conDatos.id } })).toMatchObject({
      entrega: 'envio',
      datosCliente: [{ etiqueta: 'Código postal', valor: '1414' }],
    });
    expect(await prisma.venta.findUniqueOrThrow({ where: { id: sinDatos.id } })).toMatchObject({
      entrega: null,
      datosCliente: null,
    });
  });

  it('cobra con el mejor descuento vigente, sin sumarlos, y guarda la foto del precio de lista', async () => {
    const productoTermo = termo;
    await prisma.descuento.createMany({
      data: [
        // Termo: su 10% ($ 4.500,05) le gana a los $ 500 de todo el catálogo. La bombilla sólo tiene la promo.
        { userId: dueno.id, productoId: productoTermo, tipo: 'porcentaje', valor: 10 },
        { userId: dueno.id, nombre: 'Primera compra', tipo: 'monto', valor: 50_000 },
        // Vencido: no cuenta aunque sea el mayor.
        { userId: dueno.id, nombre: 'Vieja', tipo: 'porcentaje', valor: 50, hasta: new Date(Date.now() - 60_000) },
      ],
    });
    const venta = await pedido([
      { productoId: termo, cantidad: 2 },
      { productoId: sinControl, cantidad: 1 },
    ]);
    expect(venta.items.find((item) => item.productoId === termo)).toMatchObject({
      precioListaCentavos: 4_500_050,
      descuentoCentavos: 450_005,
      precioUnitarioCentavos: 4_050_045,
      subtotalCentavos: 2 * 4_050_045,
      descuentoEtiqueta: '10% off',
    });
    expect(venta.items.find((item) => item.productoId === sinControl)).toMatchObject({
      precioListaCentavos: 350_000,
      precioUnitarioCentavos: 300_000,
      descuentoEtiqueta: '$ 500 off · Primera compra',
    });
    expect(venta.totalCentavos).toBe(2 * 4_050_045 + 300_000);
  });

  it('dos pedidos simultáneos por la última unidad: uno reserva y el otro se rechaza', async () => {
    const resultados = await Promise.allSettled([
      pedido([{ productoId: mate, cantidad: 1 }]),
      pedido([{ productoId: mate, cantidad: 1 }]),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(PedidoRechazadoError);
    expect(String(rechazo.reason.message)).toContain('No hay stock suficiente');
  });

  it('una reserva vencida ya no retiene stock', async () => {
    await pedido([{ productoId: mate, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    await expect(pedido([{ productoId: mate, cantidad: 1 }])).resolves.toMatchObject({ estado: 'pendiente_pago' });
  });

  it('rechaza productos de otro comercio o dados de baja', async () => {
    const otro = await crearUsuarioDePrueba(prisma);
    const ajeno = await prisma.producto.create({
      data: { userId: otro.id, codigo: 'X', nombre: 'Ajeno', precioCentavos: 1, stock: 9 },
    });
    await expect(pedido([{ productoId: ajeno.id, cantidad: 1 }])).rejects.toThrow('ya no está en el catálogo');
    await prisma.user.delete({ where: { id: otro.id } });
  });

  it(`una conversación no puede tener más de ${MAX_PEDIDOS_PENDIENTES} pedidos pendientes`, async () => {
    for (let i = 0; i < MAX_PEDIDOS_PENDIENTES; i++) {
      await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId });
    }
    await expect(pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId })).rejects.toThrow('pedidos sin pagar');
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).nombreCliente).toBe('Juan');
  });

  it('pagar descuenta el stock una sola vez y avisa el stock bajo', async () => {
    const venta = await pedido([{ productoId: termo, cantidad: 2 }]);

    const primero = await ventas.marcarPagada(venta.id, { mpPaymentId: 'pago-1' });
    expect(primero).toMatchObject({ nueva: true, venta: { estado: 'pagada', mpPaymentId: 'pago-1', sinStockAlPagar: false } });
    expect(primero?.stockBajo).toEqual([expect.objectContaining({ productoId: termo, stock: 3 })]);
    expect(await stockDe(termo)).toBe(3);

    const repetido = await ventas.marcarPagada(venta.id, { mpPaymentId: 'pago-1' });
    expect(repetido?.nueva).toBe(false);
    expect(await stockDe(termo)).toBe(3);
  });

  it('si se paga con la reserva vencida y no hay stock, queda pagada y marcada', async () => {
    const vieja = await pedido([{ productoId: mate, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const nueva = await pedido([{ productoId: mate, cantidad: 1 }]);
    await ventas.marcarPagada(nueva.id);

    const resultado = await ventas.marcarPagada(vieja.id);
    expect(resultado?.venta).toMatchObject({ estado: 'pagada', sinStockAlPagar: true });
    expect(await stockDe(mate)).toBe(0);
  });

  it('pedir por Mercado Pago sin cuenta conectada se rechaza sin reservar', async () => {
    cuentas.tokenDe.mockResolvedValue(null);
    await expect(pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'no conectó Mercado Pago',
    );
    expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(0);
  });

  it('por Mercado Pago guarda el link, y si Mercado Pago falla libera la reserva', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp/pagar' });

    const venta = await pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
    expect(venta).toMatchObject({ mpPreferenceId: 'pref-1', linkPago: 'https://mp/pagar' });
    const [token, entrada] = mp.crearPreferencia.mock.calls[0];
    expect(token).toBe('TOKEN');
    expect(entrada).toMatchObject({
      externalReference: venta.id,
      notificationUrl: `https://api.test/ventas/webhook?venta=${venta.id}`,
      items: [{ quantity: 1, unit_price: 45000.5, currency_id: 'ARS' }],
    });

    mp.crearPreferencia.mockRejectedValue(new MercadoPagoError('caído'));
    await expect(pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'No se pudo generar el link',
    );
    expect(await ventas.reservadasPorProducto([termo])).toEqual(new Map([[termo, 1]]));
  });

  it('un pedido en dólares se cobra a mano aunque haya Mercado Pago, y no se mezcla con uno en pesos', async () => {
    const auriculares = await prisma.producto.create({
      data: {
        userId: dueno.id,
        codigo: 'AURI',
        nombre: 'Auriculares',
        moneda: 'USD',
        precioCentavos: 2_500,
        stock: 3,
      },
    });
    const productoUsd = auriculares.id;
    try {
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });

      const venta = await pedido([{ productoId: productoUsd, cantidad: 2 }], { medioPago: 'mercadopago' });
      expect(venta).toMatchObject({ moneda: 'USD', medioPago: 'manual', totalCentavos: 5_000, linkPago: null });
      expect(mp.crearPreferencia).not.toHaveBeenCalled();
      expect(avisosDeTipo('pedido_manual')[0][1]).toMatchObject({ titulo: 'Pedido para cobrar: US$ 50' });

      await expect(
        pedido([
          { productoId: productoUsd, cantidad: 1 },
          { productoId: termo, cantidad: 1 },
        ]),
      ).rejects.toThrow('No se pueden mezclar productos en pesos y en dólares');
      expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(1);
    } finally {
      await prisma.venta.deleteMany({ where: { userId: dueno.id } });
      await prisma.producto.delete({ where: { id: auriculares.id } });
    }
  });

  it('el webhook sólo marca pagada con un pago aprobado de esa venta por el monto exacto', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-2', init_point: 'https://mp/pagar' });
    const venta = await pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
    const pago = { id: 555, status: 'approved', external_reference: venta.id, transaction_amount: 45000.5, currency_id: 'ARS' };

    mp.obtenerPago.mockResolvedValue({ ...pago, transaction_amount: 1 });
    expect(await ventas.procesarPago('555', venta.id)).toBeNull();

    mp.obtenerPago.mockResolvedValue(pago);
    expect(await ventas.procesarPago('555', venta.id)).toMatchObject({ nueva: true, venta: { mpPaymentId: '555' } });
    expect(mp.obtenerPago).toHaveBeenLastCalledWith('TOKEN', '555');
    // Pagada por Mercado Pago: aviso de venta; con link no hay aviso de pedido a cobrar.
    expect(avisosDeTipo('venta_pagada')).toHaveLength(1);
    expect(avisosDeTipo('pedido_manual')).toHaveLength(0);
  });

  it('si Mercado Pago rechaza el token del comercio, se desconecta y se le avisa', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN-VIEJO', mpUserId: '777' });
    mp.crearPreferencia.mockRejectedValue(new MercadoPagoNoAutorizadoError('401'));
    await expect(pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'No se pudo generar el link',
    );
    expect(cuentas.desconectar).toHaveBeenCalledWith(dueno.id);
    expect(avisosDeTipo('mercadopago_desconectado')).toHaveLength(1);
  });

  it('marcarla pagada a mano avisa el stock bajo pero no la venta', async () => {
    const venta = await pedido([{ productoId: termo, cantidad: 2 }]);
    notificaciones.avisar.mockClear();
    expect(await ventas.marcarPagadaPorElDueno(dueno.id, venta.id)).toMatchObject({ estado: 'pagada' });
    expect(avisosDeTipo('venta_pagada')).toHaveLength(0);
    expect(avisosDeTipo('stock_bajo')).toEqual([[dueno.id, expect.objectContaining({ clave: `stock:${termo}` })]]);
    // Ya pagada, o de otro dueño: nada.
    expect(await ventas.marcarPagadaPorElDueno(dueno.id, venta.id)).toBeNull();
    expect(await ventas.marcarPagadaPorElDueno('otro', venta.id)).toBeNull();
  });

  describe('cobro manual configurado: el chat pasa al negocio', () => {
    const configurar = (cobroManual: string | null) =>
      prisma.condicionesPago.create({
        data: {
          userId: dueno.id,
          cobroManual,
          aliasTransferencia: cobroManual === 'transferencia' ? 'mates.sur' : null,
          titularTransferencia: cobroManual === 'transferencia' ? 'Ana' : null,
        },
      });
    const pausado = async (ventaId: string) => enAtencionHumana(await prisma.venta.findUniqueOrThrow({ where: { id: ventaId } }));

    it('un pedido manual deja el chat en atención humana hasta que se paga, aunque venza la reserva', async () => {
      await configurar('transferencia');
      const venta = await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId });
      expect(venta).toMatchObject({ atencion: 'humana', motivoDerivacion: 'cobro_manual' });
      expect(await prisma.eventoVenta.count({ where: { ventaId: venta.id, tipo: 'derivacion', motivo: 'cobro_manual' } })).toBe(1);
      expect(avisosDeTipo('pedido_manual')[0][1]).toMatchObject({ cuerpo: expect.stringContaining('no contesta en ese chat') });

      // Vencida sin que el dueño haga nada: sigue pausado.
      await prisma.venta.update({ where: { id: venta.id }, data: { reservaVenceAt: new Date(Date.now() - 60_000) } });
      expect(await pausado(venta.id)).toBe(true);

      await ventas.marcarPagadaPorElDueno(dueno.id, venta.id);
      expect(await pausado(venta.id)).toBe(false);
    });

    it('cancelarlo también le devuelve el chat al asistente', async () => {
      await configurar('transferencia');
      const venta = await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId });
      await prisma.venta.update({ where: { id: venta.id }, data: { estado: 'cancelada', canceladaAt: new Date() } });
      expect(await pausado(venta.id)).toBe(false);
    });

    it('sin cobro manual configurado, o con link de Mercado Pago, el asistente sigue', async () => {
      const sinConfigurar = await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId });
      expect(sinConfigurar.atencion).toBe('asistente');

      await configurar('transferencia');
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'tok', mpUserId: '1' });
      mp.crearPreferencia.mockResolvedValue({ id: 'pref', init_point: 'https://mp/pagar' });
      const conLink = await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId, medioPago: 'mercadopago' });
      expect(conLink.atencion).toBe('asistente');
    });
  });

  it('la conciliación encuentra el pago aunque el webhook no haya llegado', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-3', init_point: 'https://mp/pagar' });
    const venta = await pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
    mp.buscarPagos.mockResolvedValue([
      { id: 1, status: 'rejected', external_reference: venta.id, transaction_amount: 45000.5, currency_id: 'ARS' },
      { id: 2, status: 'approved', external_reference: venta.id, transaction_amount: 45000.5, currency_id: 'ARS' },
    ]);

    const cobradas = await ventas.conciliar();
    expect(cobradas.map((r) => r.venta.id)).toEqual([venta.id]);
    expect((await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).mpPaymentId).toBe('2');
  });

  describe('aviso de pago aprobado al cliente', () => {
    const JID = '5491122334455@s.whatsapp.net';
    const pagoDe = (ventaId: string, id = 900) => ({
      id,
      status: 'approved',
      external_reference: ventaId,
      transaction_amount: 45000.5,
      currency_id: 'ARS',
    });
    const pedidoMp = async (extra: Record<string, unknown> = {}) => {
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
      mp.crearPreferencia.mockResolvedValue({ id: 'pref-aviso', init_point: 'https://mp/pagar' });
      return pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago', conversationId, ...extra });
    };

    it('el webhook le avisa una sola vez, en el chat del pedido, aunque llegue repetido', async () => {
      const venta = await pedidoMp();
      mp.obtenerPago.mockResolvedValue(pagoDe(venta.id));

      await ventas.procesarPago('900', venta.id);
      await ventas.procesarPago('900', venta.id);

      expect(notificaciones.avisarAlCliente).toHaveBeenCalledTimes(1);
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledWith(
        dueno.id,
        JID,
        '¡Listo, Juan! Tu pago de $ 45.000,50 fue aprobado. Te escribimos por acá para coordinar la entrega.',
      );
    });

    it('la conciliación también le avisa', async () => {
      const venta = await pedidoMp();
      mp.buscarPagos.mockResolvedValue([pagoDe(venta.id, 901)]);
      await ventas.conciliar();
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledTimes(1);
    });

    it('cuando el dueño lo marca pagado a mano, también', async () => {
      const venta = await pedido([{ productoId: termo, cantidad: 1 }], { conversationId });
      await ventas.marcarPagadaPorElDueno(dueno.id, venta.id);
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledWith(dueno.id, JID, expect.stringContaining('fue aprobado'));
    });

    it('un pedido del banco de pruebas o sin conversación no le escribe a nadie', async () => {
      const dePrueba = await pedidoMp({ dePrueba: true });
      mp.obtenerPago.mockResolvedValue(pagoDe(dePrueba.id, 902));
      await ventas.procesarPago('902', dePrueba.id);

      const sinChat = await pedido([{ productoId: termo, cantidad: 1 }]);
      await ventas.marcarPagadaPorElDueno(dueno.id, sinChat.id);

      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
    });

    it('si el aviso falla, la venta igual queda pagada', async () => {
      notificaciones.avisarAlCliente.mockRejectedValue(new Error('socket caído'));
      const venta = await pedidoMp();
      mp.obtenerPago.mockResolvedValue(pagoDe(venta.id, 903));
      expect(await ventas.procesarPago('903', venta.id)).toMatchObject({ nueva: true, venta: { estado: 'pagada' } });
    });
  });

  describe('recordatorio de pago al cliente', () => {
    const JID = '5491122334455@s.whatsapp.net';
    const T = new Date();
    const enMinutos = (n: number) => new Date(T.getTime() + n * 60_000);
    const pedidoMp = async (extra: Record<string, unknown> = {}) => {
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
      mp.crearPreferencia.mockResolvedValue({ id: 'pref-recordatorio', init_point: 'https://mp/pagar' });
      return pedido([{ productoId: termo, cantidad: 1 }], { medioPago: 'mercadopago', conversationId, ahora: T, ...extra });
    };

    beforeEach(() => {
      // El barrido es global: sólo el dueño de este spec tiene el asistente activo, así no le escribe a otros.
      suscripcion.asistenteActivo.mockImplementation(async (userId: string) => userId === dueno.id);
      notificaciones.avisarAlCliente.mockResolvedValue(true);
      horario.puedeEscribir.mockResolvedValue(true);
    });

    // Un cobro manual de otro test pudo dejar el chat en atención humana: sólo el botón lo devuelve (LAU-81).
    beforeEach(async () => {
      await prisma.conversation.update({ where: { id: conversationId }, data: { atencion: 'asistente' } });
    });

    it('cuando faltan 10 minutos le recuerda una sola vez, en el chat del pedido, sin link', async () => {
      const venta = await pedidoMp();

      expect(await ventas.recordarPagos(enMinutos(25))).toBe(1);
      expect(await ventas.recordarPagos(enMinutos(27))).toBe(0);

      expect(notificaciones.avisarAlCliente).toHaveBeenCalledTimes(1);
      const [userId, jid, texto] = notificaciones.avisarAlCliente.mock.calls[0] as [string, string, string];
      expect([userId, jid]).toEqual([dueno.id, JID]);
      expect(texto).toMatch(/^¡Hola, Juan! Te recordamos que tu pedido de \$ 45\.000,50 te lo guardamos hasta las \d{2}:\d{2}\./);
      expect(texto).not.toContain('https://');
      expect((await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).recordatorioPagoAt).toEqual(enMinutos(25));
    });

    it('no le escribe antes de tiempo ni con la reserva ya vencida', async () => {
      await pedidoMp();
      expect(await ventas.recordarPagos(enMinutos(10))).toBe(0);
      expect(await ventas.recordarPagos(enMinutos(31))).toBe(0);
      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
    });

    it('nunca a un pedido pagado, a coordinar, de prueba o sin chat', async () => {
      const pagada = await pedidoMp();
      await ventas.marcarPagada(pagada.id);
      notificaciones.avisarAlCliente.mockClear();
      await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId, ahora: new Date(T.getTime() - 24 * 60 * 60_000 + 30 * 60_000) });
      await pedidoMp({ dePrueba: true });
      await pedidoMp({ conversationId: null });

      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);
      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
    });

    it('no le recuerda un pedido viejo si después pidió otro en el mismo chat', async () => {
      const vieja = await pedidoMp();
      await pedido([{ productoId: sinControl, cantidad: 1 }], { conversationId, ahora: enMinutos(5) });

      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);
      expect((await prisma.venta.findUniqueOrThrow({ where: { id: vieja.id } })).recordatorioPagoAt).toBeNull();
    });

    it('se calla con el chat en atención humana o con el asistente suspendido', async () => {
      await pedidoMp();
      await prisma.conversation.update({ where: { id: conversationId }, data: { atencion: 'humana', tomadaAt: T } });
      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);

      await prisma.conversation.update({ where: { id: conversationId }, data: { atencion: 'asistente' } });
      suscripcion.asistenteActivo.mockResolvedValue(false);
      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);
      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
    });

    it('fuera del horario de atención, sin conversación en curso, no le escribe', async () => {
      const venta = await pedidoMp();
      horario.puedeEscribir.mockResolvedValue(false);

      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);
      expect(horario.puedeEscribir).toHaveBeenCalledWith(dueno.id, conversationId, enMinutos(25));
      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
      expect((await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).recordatorioPagoAt).toBeNull();
    });

    it('si el envío falla no lo reintenta', async () => {
      notificaciones.avisarAlCliente.mockResolvedValue(false);
      await pedidoMp();
      expect(await ventas.recordarPagos(enMinutos(25))).toBe(0);
      expect(await ventas.recordarPagos(enMinutos(26))).toBe(0);
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledTimes(1);
    });
  });

  it('vence las reservas pasadas de hora y cancela sólo lo que está sin pagar', async () => {
    const vieja = await pedido([{ productoId: sinControl, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    // El barrido es global: en la base compartida puede vencer también reservas de otros specs.
    expect(await ventas.vencerReservas()).toBeGreaterThanOrEqual(1);
    expect((await prisma.venta.findUniqueOrThrow({ where: { id: vieja.id } })).estado).toBe('vencida');

    const pagada = await pedido([{ productoId: sinControl, cantidad: 1 }]);
    await ventas.marcarPagada(pagada.id);
    expect(await ventas.cancelar(dueno.id, pagada.id)).toBeNull();
    expect(await ventas.cancelar(dueno.id, vieja.id)).toMatchObject({ estado: 'cancelada' });
  });

  describe('formas de pago (LAU-34)', () => {
    const condiciones = () =>
      prisma.condicionesPago.create({ data: { userId: dueno.id, descuentoEfectivoPorcentaje: 10 } });
    const conCuotas = (id: string, cuotas: CuotasProducto) => prisma.producto.update({ where: { id }, data: { cuotas } });
    /** El termo sin control: $ 3.500 de lista; en 6 cuotas, $ 4.025 por unidad (15% más). */
    const precioPorPlan: CuotasProducto = {
      modo: 'precios',
      planes: [
        { cuotas: 3, totalCentavos: 350_000 },
        { cuotas: 6, totalCentavos: 402_500 },
      ],
    };

    it('en efectivo aplica el descuento, lo deja a cobrar a mano y no lo suma a una promo mejor', async () => {
      await condiciones();
      await prisma.descuento.create({
        data: { userId: dueno.id, nombre: 'Termos', tipo: 'porcentaje', valor: 20, productoId: null, categoria: null },
      });
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
      const venta = await pedido(
        [
          { productoId: mate, cantidad: 1 },
          { productoId: sinControl, cantidad: 1 },
        ],
        { medioPago: 'mercadopago', formaPago: 'efectivo' },
      );
      // La promo de catálogo (20%) gana al 10% del efectivo: no se suman.
      expect(venta).toMatchObject({ medioPago: 'manual', formaPago: 'efectivo', recargoCentavos: 0, totalCentavos: 640_000 + 280_000 });
      expect(mp.crearPreferencia).not.toHaveBeenCalled();
    });

    it('el descuento en efectivo no se aplica con otro medio', async () => {
      await condiciones();
      const venta = await pedido([{ productoId: sinControl, cantidad: 2 }]);
      expect(venta).toMatchObject({ formaPago: null, totalCentavos: 700_000 });
      expect(venta.items[0].descuentoCentavos).toBe(0);
      const enEfectivo = await pedido([{ productoId: sinControl, cantidad: 2 }], { formaPago: 'efectivo' });
      expect(enEfectivo.totalCentavos).toBe(630_000);
    });

    it('en cuotas con recargo lo suma al total y al link', async () => {
      await conCuotas(sinControl, { modo: 'recargo', recargoPorcentaje: 15, planes: [3, 6] });
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
      mp.crearPreferencia.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp/pagar' });
      const venta = await pedido([{ productoId: sinControl, cantidad: 2 }], {
        medioPago: 'mercadopago',
        formaPago: 'cuotas',
        cuotas: 6,
      });
      expect(venta).toMatchObject({ formaPago: 'cuotas', cuotas: 6, recargoCentavos: 105_000, totalCentavos: 805_000 });
      const [, preferencia] = mp.crearPreferencia.mock.calls[0];
      expect(preferencia.cuotas).toBe(6);
      const suma = preferencia.items.reduce(
        (total: number, item: { quantity: number; unit_price: number }) => total + Math.round(item.quantity * item.unit_price * 100),
        0,
      );
      expect(suma).toBe(805_000);
    });

    it('con precio por plan cobra ese total aunque haya una promo', async () => {
      await conCuotas(sinControl, precioPorPlan);
      await prisma.descuento.create({
        data: { userId: dueno.id, nombre: 'Termos', tipo: 'porcentaje', valor: 20, productoId: null, categoria: null },
      });
      const venta = await pedido([{ productoId: sinControl, cantidad: 1 }], { formaPago: 'cuotas', cuotas: 3 });
      // El renglón queda con la promo ($ 2.800) y el plan completa hasta su total.
      expect(venta.items[0].precioUnitarioCentavos).toBe(280_000);
      expect(venta).toMatchObject({ recargoCentavos: 70_000, totalCentavos: 350_000 });
    });

    it('rechaza las cuotas de un producto en un pago, un plan que no tiene o un pedido en dólares', async () => {
      await expect(pedido([{ productoId: sinControl, cantidad: 1 }], { formaPago: 'cuotas', cuotas: 3 })).rejects.toThrow(
        'se vende en un pago',
      );
      await conCuotas(sinControl, precioPorPlan);
      await expect(pedido([{ productoId: sinControl, cantidad: 1 }], { formaPago: 'cuotas', cuotas: 12 })).rejects.toThrow(
        'no hay plan de 12 cuotas',
      );
      expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(0);
    });

    it('cotiza cada forma de pago sin reservar nada', async () => {
      await condiciones();
      await conCuotas(sinControl, precioPorPlan);
      const cotizacion = await ventas.cotizarFormasDePago(dueno.id, [{ productoId: sinControl, cantidad: 2 }]);
      expect(cotizacion).toEqual({
        moneda: 'ARS',
        contadoCentavos: 700_000,
        efectivoCentavos: 630_000,
        planes: [
          { cuotas: 3, recargoCentavos: 0, totalCentavos: 700_000, cuotaCentavos: 233_334 },
          { cuotas: 6, recargoCentavos: 105_000, totalCentavos: 805_000, cuotaCentavos: 134_167 },
        ],
        sinCuotas: null,
      });
      expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(0);
    });

    it('un pedido de varios productos sólo va en las cuotas que tienen todos', async () => {
      await conCuotas(sinControl, precioPorPlan);
      await conCuotas(mate, { modo: 'recargo', recargoPorcentaje: 0, planes: [3, 12] });
      const items = [
        { productoId: mate, cantidad: 1 },
        { productoId: sinControl, cantidad: 1 },
      ];
      const cotizacion = await ventas.cotizarFormasDePago(dueno.id, items);
      expect(cotizacion.planes.map((plan) => plan.cuotas)).toEqual([3]);
      await expect(pedido(items, { formaPago: 'cuotas', cuotas: 6 })).rejects.toThrow('Los que hay son de 3 cuotas');
      expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(0);
      expect(await pedido(items, { formaPago: 'cuotas', cuotas: 3 })).toMatchObject({ cuotas: 3, recargoCentavos: 0 });

      await prisma.producto.update({ where: { id: mate }, data: { cuotas: Prisma.DbNull } });
      expect((await ventas.cotizarFormasDePago(dueno.id, items)).sinCuotas).toBe('sin_comun');
    });

    it('en un pago con link no deja usar las cuotas de la cuenta de Mercado Pago', async () => {
      cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
      mp.crearPreferencia.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp/pagar' });
      await pedido([{ productoId: sinControl, cantidad: 1 }], { medioPago: 'mercadopago' });
      expect(mp.crearPreferencia.mock.calls[0][1]).toMatchObject({ maxCuotas: 1 });
      // Aunque el producto tenga cuotas: van por su plan, con su recargo.
      await conCuotas(sinControl, precioPorPlan);
      await pedido([{ productoId: sinControl, cantidad: 1 }], { medioPago: 'mercadopago' });
      expect(mp.crearPreferencia.mock.calls[1][1]).toMatchObject({ maxCuotas: 1 });
      expect(mp.crearPreferencia.mock.calls[1][1].cuotas).toBeUndefined();
    });

  });
});
