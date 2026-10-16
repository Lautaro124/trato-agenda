/**
 * Pedidos a medida contra Postgres real (LAU-24/26/27/28): el mismo pedido de
 * la solicitud al pago, con sus presupuestos versionados, el historial y la
 * atención humana. Ver test/base-de-prueba.ts.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MercadoPagoClient } from '../subscription/mercadopago.client.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { PedidosAMedidaService } from './pedidos-a-medida.service.js';
import { normalizarRenglones } from './presupuesto.rules.js';
import { HistoricoVentasService } from './historico.service.js';
import { PedidoRechazadoError, VentasService } from './ventas.service.js';

const config = { get: (clave: string) => (clave === 'API_PUBLIC_URL' ? 'https://api.test' : '') } as unknown as ConfigService<
  Env,
  true
>;

describe.skipIf(!hayBaseDePrueba)('pedidos a medida (Postgres real)', () => {
  let prisma: PrismaService;
  let dueno: User;
  let otro: User;
  let conversationId: string;
  let productoId: string;
  const remoteJid = '5491122334455@s.whatsapp.net';
  const mp = { crearPreferencia: vi.fn(), vencerPreferencia: vi.fn(), buscarPagos: vi.fn(), obtenerPago: vi.fn() };
  const cuentas = { tokenDe: vi.fn(), desconectar: vi.fn() };
  const notificaciones = { avisar: vi.fn(), avisarAlCliente: vi.fn() };
  let ventas: VentasService;
  let pedidos: PedidosAMedidaService;

  const armado = (precio: number) => {
    const resultado = normalizarRenglones([{ concepto: 'Placard completo', cantidad: 1, precioUnitarioCentavos: precio }]);
    if ('error' in resultado) throw new Error(resultado.error);
    return { ...resultado, estimativo: false, detalleAlCliente: false };
  };

  const solicitar = (respuesta = '120') =>
    pedidos.registrarSolicitud({
      userId: dueno.id,
      conversationId,
      remoteJid,
      nombreCliente: 'Ana',
      producto: { id: productoId, nombre: 'Placard' },
      respuestas: [{ pregunta: 'Ancho (cm)', respuesta }],
      resumen: 'Un placard para el dormitorio',
      dePrueba: false,
    });

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
    pedidos = new PedidosAMedidaService(
      prisma,
      ventas,
      cuentas as unknown as CuentaMercadoPagoService,
      notificaciones as unknown as NotificacionesService,
    );
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    cuentas.tokenDe.mockResolvedValue(null);
    notificaciones.avisarAlCliente.mockResolvedValue(true);
    await prisma.venta.deleteMany({ where: { userId: dueno.id } });
    await prisma.conversation.deleteMany({ where: { userId: dueno.id } });
    await prisma.producto.deleteMany({ where: { userId: dueno.id } });
    conversationId = (await prisma.conversation.create({ data: { userId: dueno.id, remoteJid } })).id;
    productoId = (
      await prisma.producto.create({
        data: { userId: dueno.id, codigo: 'PLACARD', nombre: 'Placard', descripcion: '', textoBusqueda: 'placard', solicitud: { preguntas: [] } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('de la solicitud al pago es el mismo pedido, con su historial', async () => {
    const { venta, nueva } = await solicitar();
    expect(nueva).toBe(true);
    expect(venta).toMatchObject({ tipo: 'a_medida', estado: 'a_cotizar', totalCentavos: null, reservaVenceAt: null, medioPago: null });

    const borrador = await pedidos.crearPresupuesto(dueno.id, venta.id, armado(12_000_000), 'dueno');
    // Un borrador no cambia el pedido ni le llega al cliente.
    expect(borrador?.venta.estado).toBe('a_cotizar');
    const enviado = await pedidos.enviarPresupuesto(dueno.id, venta.id, borrador!.presupuesto.id, {
      autor: 'dueno',
      mandarAlCliente: true,
    });
    expect(enviado?.venta).toMatchObject({ estado: 'cotizado', totalCentavos: 12_000_000 });
    expect(enviado?.mandado).toBe(true);
    expect(notificaciones.avisarAlCliente).toHaveBeenCalledWith(dueno.id, remoteJid, expect.stringContaining('*Total: $ 120.000*'));

    const cobro = await pedidos.cobrar(dueno.id, venta.id, { autor: 'asistente', conversationId });
    expect(cobro).toMatchObject({ estado: 'pendiente_pago', medioPago: 'manual' });
    expect(cobro.items).toMatchObject([{ varianteId: null, codigo: 'PLACARD', subtotalCentavos: 12_000_000, nombreVariante: 'Presupuesto v1' }]);
    // Un "sí" repetido no genera otro cobro.
    expect((await pedidos.cobrar(dueno.id, venta.id, { autor: 'asistente', conversationId })).items).toHaveLength(1);

    const pagada = await ventas.marcarPagadaPorElDueno(dueno.id, venta.id);
    expect(pagada).toMatchObject({ id: venta.id, estado: 'pagada' });

    const eventos = await prisma.eventoVenta.findMany({ where: { ventaId: venta.id }, orderBy: { createdAt: 'asc' } });
    expect(eventos.filter((e) => e.tipo === 'estado').map((e) => e.a)).toEqual(['a_cotizar', 'cotizado', 'pendiente_pago', 'pagada']);
  });

  it('un cambio en lo que pidió vuelve a "a cotizar" y el presupuesto anterior deja de valer; uno igual no hace nada', async () => {
    const { venta } = await solicitar('120');
    const borrador = await pedidos.crearPresupuesto(dueno.id, venta.id, armado(10_000_000), 'dueno');
    await pedidos.enviarPresupuesto(dueno.id, venta.id, borrador!.presupuesto.id, { autor: 'dueno', mandarAlCliente: false });

    const igual = await solicitar('120');
    expect(igual).toMatchObject({ nueva: false, cambio: false, venta: { estado: 'cotizado' } });

    const distinta = await solicitar('140');
    expect(distinta).toMatchObject({ nueva: false, cambio: true, venta: { id: venta.id, estado: 'a_cotizar', totalCentavos: null } });
    expect(distinta.venta.presupuestos.map((p) => p.estado)).toEqual(['reemplazado']);
    await expect(pedidos.cobrar(dueno.id, venta.id, { autor: 'asistente' })).rejects.toBeInstanceOf(PedidoRechazadoError);
  });

  it('recotizar vence el link anterior: no se puede cobrar un precio viejo', async () => {
    cuentas.tokenDe.mockResolvedValue({ accessToken: 'tok' });
    mp.crearPreferencia.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp/1' });
    const { venta } = await solicitar();
    const v1 = await pedidos.crearPresupuesto(dueno.id, venta.id, armado(10_000_000), 'dueno');
    await pedidos.enviarPresupuesto(dueno.id, venta.id, v1!.presupuesto.id, { autor: 'dueno', mandarAlCliente: false });
    expect(await pedidos.cobrar(dueno.id, venta.id, { autor: 'asistente' })).toMatchObject({
      estado: 'pendiente_pago',
      linkPago: 'https://mp/1',
      mpPreferenceId: 'pref-1',
    });

    const v2 = await pedidos.crearPresupuesto(dueno.id, venta.id, armado(11_000_000), 'dueno');
    const enviado = await pedidos.enviarPresupuesto(dueno.id, venta.id, v2!.presupuesto.id, { autor: 'dueno', mandarAlCliente: false });

    expect(enviado?.venta).toMatchObject({ estado: 'cotizado', totalCentavos: 11_000_000, linkPago: null, mpPreferenceId: null });
    expect(mp.vencerPreferencia).toHaveBeenCalledWith('tok', 'pref-1', expect.any(Date));
    expect(enviado?.venta.presupuestos.map((p) => [p.version, p.estado])).toEqual([
      [1, 'reemplazado'],
      [2, 'enviado'],
    ]);
  });

  it('atención humana: calla el chat hasta que se devuelve o se cierra el pedido', async () => {
    const venta = await pedidos.derivar({
      userId: dueno.id,
      conversationId,
      remoteJid,
      nombreCliente: 'Ana',
      motivo: 'pide_persona',
      detalle: 'Quiere hablar con alguien',
      autor: 'asistente',
      dePrueba: false,
    });
    // Sin pedido previo, el lead queda atado a uno nuevo.
    expect(venta).toMatchObject({ tipo: 'a_medida', estado: 'solicitado', atencion: 'humana', motivoDerivacion: 'pide_persona' });
    expect(notificaciones.avisar).toHaveBeenCalledWith(dueno.id, expect.objectContaining({ tipo: 'pedido_derivado' }));
    expect(await pedidos.enAtencionHumana(dueno.id, remoteJid)).toBe(true);
    expect(await pedidos.enAtencionHumana(otro.id, remoteJid)).toBe(false);

    await pedidos.guardarMensajeEnPausa(dueno.id, remoteJid, '¿hola?', 'cliente');
    await pedidos.devolver(dueno.id, venta.id, 'Le pasé el precio por teléfono');
    expect(await pedidos.enAtencionHumana(dueno.id, remoteJid)).toBe(false);

    const detalle = await pedidos.detalle(dueno.id, venta.id);
    expect(detalle?.eventos.map((e) => e.tipo)).toEqual(['estado', 'derivacion', 'devolucion']);
    expect(detalle?.mensajes).toMatchObject([{ role: 'user', content: { content: '¿hola?', enAtencionHumana: true } }]);

    await pedidos.derivar({
      userId: dueno.id,
      ventaId: venta.id,
      conversationId: null,
      remoteJid: null,
      nombreCliente: null,
      motivo: 'dueno',
      detalle: null,
      autor: 'dueno',
      dePrueba: false,
    });
    expect(await pedidos.enAtencionHumana(dueno.id, remoteJid)).toBe(true);
    await ventas.cancelar(dueno.id, venta.id);
    expect(await pedidos.enAtencionHumana(dueno.id, remoteJid)).toBe(false);
  });

  it('un pedido de otro comercio es como si no existiera', async () => {
    const { venta } = await solicitar();
    expect(await pedidos.detalle(otro.id, venta.id)).toBeNull();
    expect(await pedidos.crearPresupuesto(otro.id, venta.id, armado(1_000), 'dueno')).toBeNull();
    expect(await pedidos.devolver(otro.id, venta.id, null)).toBeNull();
    await expect(pedidos.cobrar(otro.id, venta.id, { autor: 'dueno' })).rejects.toBeInstanceOf(PedidoRechazadoError);
  });

  it('los pedidos sin cotizar no suman como cobrado ni como pendiente', async () => {
    await solicitar();
    const historico = new HistoricoVentasService(prisma);
    const { totales, ventas: listado } = await historico.listar(dueno.id, {});
    expect(totales).toMatchObject({ cobradoCentavos: 0, pendienteCentavos: 0, pendientes: 0, porCotizar: 1 });
    expect(listado).toMatchObject([{ tipo: 'a_medida', estado: 'a_cotizar', totalCentavos: null }]);
    expect((await historico.listar(dueno.id, { estado: 'a_cotizar' })).total).toBe(1);
    expect((await historico.listar(dueno.id, { q: 'placard' })).total).toBe(1);
  });
});
