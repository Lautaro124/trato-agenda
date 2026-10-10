/**
 * Pedidos contra Postgres real: la reserva con FOR UPDATE, el descuento de
 * stock y la idempotencia del pago son SQL que un mock no prueba. Ver
 * test/base-de-prueba.ts.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import {
  MercadoPagoError,
  MercadoPagoNoAutorizadoError,
  type MercadoPagoClient,
} from '../subscription/mercadopago.client.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { MAX_PEDIDOS_PENDIENTES } from './ventas.rules.js';
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
  const avisosDeTipo = (tipo: string) =>
    notificaciones.avisar.mock.calls.filter(([, aviso]) => (aviso as { tipo: string }).tipo === tipo);
  let ventas: VentasService;

  const pedido = (items: Array<{ varianteId: string; cantidad: number }>, extra: Record<string, unknown> = {}) =>
    ventas.crearPedido({
      userId: dueno.id,
      conversationId: null,
      remoteJid: '5491122334455@s.whatsapp.net',
      nombreCliente: 'Juan',
      items,
      medioPago: 'manual',
      ...extra,
    });

  const stockDe = async (varianteId: string) =>
    (await prisma.variante.findUniqueOrThrow({ where: { id: varianteId } })).stock;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    ventas = new VentasService(
      prisma,
      mp as unknown as MercadoPagoClient,
      cuentas as unknown as CuentaMercadoPagoService,
      config,
      notificaciones as unknown as NotificacionesService,
    );
    dueno = await crearUsuarioDePrueba(prisma);
    const crear = (codigo: string, precioCentavos: number, stock: number | null, stockMinimo: number | null = null) =>
      prisma.producto.create({
        data: {
          userId: dueno.id,
          codigo,
          nombre: `Producto ${codigo}`,
          variantes: { create: [{ sku: codigo, precioCentavos, stock, stockMinimo }] },
        },
        include: { variantes: true },
      });
    mate = (await crear('MATE', 800_000, 1)).variantes[0].id;
    termo = (await crear('TERMO', 4_500_050, 5, 3)).variantes[0].id;
    sinControl = (await crear('BOMBILLA', 350_000, null)).variantes[0].id;
    conversationId = (await prisma.conversation.create({ data: { userId: dueno.id, remoteJid: '5491122334455@s.whatsapp.net' } })).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: dueno.id } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    await prisma.venta.deleteMany({ where: { userId: dueno.id } });
    await prisma.variante.update({ where: { id: mate }, data: { stock: 1 } });
    await prisma.variante.update({ where: { id: termo }, data: { stock: 5 } });
  });

  it('crea el pedido con la foto de los productos, el total y la reserva', async () => {
    const venta = await pedido([
      { varianteId: termo, cantidad: 2 },
      { varianteId: sinControl, cantidad: 1 },
      { varianteId: termo, cantidad: 1 },
    ]);
    expect(venta).toMatchObject({
      estado: 'pendiente_pago',
      medioPago: 'manual',
      nombreCliente: 'Juan',
      telefonoCliente: '5491122334455',
      totalCentavos: 3 * 4_500_050 + 350_000,
    });
    expect(venta.items.find((item) => item.varianteId === termo)).toMatchObject({
      codigo: 'TERMO',
      cantidad: 3,
      precioUnitarioCentavos: 4_500_050,
    });
    // Un pedido a cobrar a mano le llega al dueño.
    expect(avisosDeTipo('pedido_manual')).toEqual([[dueno.id, expect.objectContaining({ enlace: `/ventas?venta=${venta.id}` })]]);
    // Reservar no descuenta stock: eso pasa recién al pagar.
    expect(await stockDe(termo)).toBe(5);
    expect(await ventas.reservadasPorVariante([termo])).toEqual(new Map([[termo, 3]]));
  });

  it('guarda la entrega y los datos del cliente; sin datos la columna queda vacía', async () => {
    const conDatos = await pedido([{ varianteId: sinControl, cantidad: 1 }], {
      entrega: 'envio',
      datosCliente: [{ etiqueta: 'Código postal', valor: '1414' }],
    });
    const sinDatos = await pedido([{ varianteId: sinControl, cantidad: 1 }]);
    expect(await prisma.venta.findUniqueOrThrow({ where: { id: conDatos.id } })).toMatchObject({
      entrega: 'envio',
      datosCliente: [{ etiqueta: 'Código postal', valor: '1414' }],
    });
    expect(await prisma.venta.findUniqueOrThrow({ where: { id: sinDatos.id } })).toMatchObject({
      entrega: null,
      datosCliente: null,
    });
  });

  it('dos pedidos simultáneos por la última unidad: uno reserva y el otro se rechaza', async () => {
    const resultados = await Promise.allSettled([
      pedido([{ varianteId: mate, cantidad: 1 }]),
      pedido([{ varianteId: mate, cantidad: 1 }]),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(PedidoRechazadoError);
    expect(String(rechazo.reason.message)).toContain('No hay stock suficiente');
  });

  it('una reserva vencida ya no retiene stock', async () => {
    await pedido([{ varianteId: mate, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    await expect(pedido([{ varianteId: mate, cantidad: 1 }])).resolves.toMatchObject({ estado: 'pendiente_pago' });
  });

  it('rechaza variantes de otro comercio o dadas de baja', async () => {
    const otro = await crearUsuarioDePrueba(prisma);
    const ajena = await prisma.producto.create({
      data: { userId: otro.id, codigo: 'X', nombre: 'Ajeno', variantes: { create: [{ sku: 'X', precioCentavos: 1, stock: 9 }] } },
      include: { variantes: true },
    });
    await expect(pedido([{ varianteId: ajena.variantes[0].id, cantidad: 1 }])).rejects.toThrow('ya no está en el catálogo');
    await prisma.user.delete({ where: { id: otro.id } });
  });

  it(`una conversación no puede tener más de ${MAX_PEDIDOS_PENDIENTES} pedidos pendientes`, async () => {
    for (let i = 0; i < MAX_PEDIDOS_PENDIENTES; i++) {
      await pedido([{ varianteId: sinControl, cantidad: 1 }], { conversationId });
    }
    await expect(pedido([{ varianteId: sinControl, cantidad: 1 }], { conversationId })).rejects.toThrow('pedidos sin pagar');
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).nombreCliente).toBe('Juan');
  });

  it('pagar descuenta el stock una sola vez y avisa el stock bajo', async () => {
    const venta = await pedido([{ varianteId: termo, cantidad: 2 }]);

    const primero = await ventas.marcarPagada(venta.id, { mpPaymentId: 'pago-1' });
    expect(primero).toMatchObject({ nueva: true, venta: { estado: 'pagada', mpPaymentId: 'pago-1', sinStockAlPagar: false } });
    expect(primero?.stockBajo).toEqual([expect.objectContaining({ varianteId: termo, stock: 3 })]);
    expect(await stockDe(termo)).toBe(3);

    const repetido = await ventas.marcarPagada(venta.id, { mpPaymentId: 'pago-1' });
    expect(repetido?.nueva).toBe(false);
    expect(await stockDe(termo)).toBe(3);
  });

  it('si se paga con la reserva vencida y no hay stock, queda pagada y marcada', async () => {
    const vieja = await pedido([{ varianteId: mate, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const nueva = await pedido([{ varianteId: mate, cantidad: 1 }]);
    await ventas.marcarPagada(nueva.id);

    const resultado = await ventas.marcarPagada(vieja.id);
    expect(resultado?.venta).toMatchObject({ estado: 'pagada', sinStockAlPagar: true });
    expect(await stockDe(mate)).toBe(0);
  });

  it('pedir por Mercado Pago sin cuenta conectada se rechaza sin reservar', async () => {
    cuentas.tokenDe.mockResolvedValue(null);
    await expect(pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'no conectó Mercado Pago',
    );
    expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(0);
  });

  it('por Mercado Pago guarda el link, y si Mercado Pago falla libera la reserva', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp/pagar' });

    const venta = await pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
    expect(venta).toMatchObject({ mpPreferenceId: 'pref-1', linkPago: 'https://mp/pagar' });
    const [token, entrada] = mp.crearPreferencia.mock.calls[0];
    expect(token).toBe('TOKEN');
    expect(entrada).toMatchObject({
      externalReference: venta.id,
      notificationUrl: `https://api.test/ventas/webhook?venta=${venta.id}`,
      items: [{ quantity: 1, unit_price: 45000.5, currency_id: 'ARS' }],
    });

    mp.crearPreferencia.mockRejectedValue(new MercadoPagoError('caído'));
    await expect(pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'No se pudo generar el link',
    );
    expect(await ventas.reservadasPorVariante([termo])).toEqual(new Map([[termo, 1]]));
  });

  it('el webhook sólo marca pagada con un pago aprobado de esa venta por el monto exacto', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-2', init_point: 'https://mp/pagar' });
    const venta = await pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
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
    await expect(pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' })).rejects.toThrow(
      'No se pudo generar el link',
    );
    expect(cuentas.desconectar).toHaveBeenCalledWith(dueno.id);
    expect(avisosDeTipo('mercadopago_desconectado')).toHaveLength(1);
  });

  it('marcarla pagada a mano avisa el stock bajo pero no la venta', async () => {
    const venta = await pedido([{ varianteId: termo, cantidad: 2 }]);
    notificaciones.avisar.mockClear();
    expect(await ventas.marcarPagadaPorElDueno(dueno.id, venta.id)).toMatchObject({ estado: 'pagada' });
    expect(avisosDeTipo('venta_pagada')).toHaveLength(0);
    expect(avisosDeTipo('stock_bajo')).toEqual([[dueno.id, expect.objectContaining({ clave: `stock:${termo}` })]]);
    // Ya pagada, o de otro dueño: nada.
    expect(await ventas.marcarPagadaPorElDueno(dueno.id, venta.id)).toBeNull();
    expect(await ventas.marcarPagadaPorElDueno('otro', venta.id)).toBeNull();
  });

  it('la conciliación encuentra el pago aunque el webhook no haya llegado', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'TOKEN', mpUserId: '777' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-3', init_point: 'https://mp/pagar' });
    const venta = await pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago' });
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
      return pedido([{ varianteId: termo, cantidad: 1 }], { medioPago: 'mercadopago', conversationId, ...extra });
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
        '¡Listo, Juan! Tu pago de $ 45.000,50 fue aprobado. El negocio te escribe por acá para coordinar la entrega.',
      );
    });

    it('la conciliación también le avisa', async () => {
      const venta = await pedidoMp();
      mp.buscarPagos.mockResolvedValue([pagoDe(venta.id, 901)]);
      await ventas.conciliar();
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledTimes(1);
    });

    it('cuando el dueño lo marca pagado a mano, también', async () => {
      const venta = await pedido([{ varianteId: termo, cantidad: 1 }], { conversationId });
      await ventas.marcarPagadaPorElDueno(dueno.id, venta.id);
      expect(notificaciones.avisarAlCliente).toHaveBeenCalledWith(dueno.id, JID, expect.stringContaining('fue aprobado'));
    });

    it('un pedido del banco de pruebas o sin conversación no le escribe a nadie', async () => {
      const dePrueba = await pedidoMp({ dePrueba: true });
      mp.obtenerPago.mockResolvedValue(pagoDe(dePrueba.id, 902));
      await ventas.procesarPago('902', dePrueba.id);

      const sinChat = await pedido([{ varianteId: termo, cantidad: 1 }]);
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

  it('vence las reservas pasadas de hora y cancela sólo lo que está sin pagar', async () => {
    const vieja = await pedido([{ varianteId: sinControl, cantidad: 1 }], { ahora: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    expect(await ventas.vencerReservas()).toBe(1);
    expect((await prisma.venta.findUniqueOrThrow({ where: { id: vieja.id } })).estado).toBe('vencida');

    const pagada = await pedido([{ varianteId: sinControl, cantidad: 1 }]);
    await ventas.marcarPagada(pagada.id);
    expect(await ventas.cancelar(dueno.id, pagada.id)).toBeNull();
    expect(await ventas.cancelar(dueno.id, vieja.id)).toMatchObject({ estado: 'cancelada' });
  });
});
