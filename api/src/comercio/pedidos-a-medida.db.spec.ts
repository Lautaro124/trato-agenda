/**
 * Pedidos a medida contra Postgres real (LAU-24/26/27/28): el mismo pedido de
 * la solicitud al pago, con sus presupuestos versionados, el historial y la
 * atención humana. Ver test/base-de-prueba.ts.
 */
import { RegistroPerformanceService } from '../performance/registro.service.js';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import type { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MercadoPagoClient } from '../subscription/mercadopago.client.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { CostosService } from './costos.service.js';
import type { IndexadorService } from './indexador.service.js';
import { ProductosService } from './productos.service.js';
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
  const suscripcion = { asistenteActivo: vi.fn() };
  const horario = { puedeEscribir: vi.fn() };
  let ventas: VentasService;
  let pedidos: PedidosAMedidaService;
  let costos: CostosService;

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
      new RegistroPerformanceService(prisma),
      suscripcion as unknown as SubscriptionService,
      horario as unknown as HorarioAtencionService,
    );
    costos = new CostosService(prisma);
    pedidos = new PedidosAMedidaService(
      prisma,
      ventas,
      cuentas as unknown as CuentaMercadoPagoService,
      notificaciones as unknown as NotificacionesService,
      costos,
      new RegistroPerformanceService(prisma),
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
    await prisma.insumo.deleteMany({ where: { userId: dueno.id } });
    await prisma.configCotizacion.deleteMany({ where: { userId: dueno.id } });
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

  describe('cotización con la receta (LAU-26)', () => {
    const PREGUNTAS = {
      preguntas: [
        { texto: 'Ancho (cm)', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true, numero: { variable: 'ancho', unidad: 'cm', min: null, max: null } },
      ],
    };

    async function conReceta(politica: 'automatica' | 'revision' | 'manual') {
      await prisma.agent.upsert({
        where: { userId: dueno.id },
        create: {
          userId: dueno.id,
          systemPrompt: '',
          allowedActions: [],
          tipoUso: 'comercio',
          descripcion: '',
          tipoAsistente: 'ventas',
          nombreTitular: 'Casa',
          nombreBot: 'Sol',
          tiposEvento: [],
          horaDesde: '00:00',
          horaHasta: '23:59',
        },
        update: { tipoAsistente: 'ventas' },
      });
      const melamina = await costos.crearInsumo(dueno.id, { tipo: 'material', nombre: 'Melamina', unidad: 'm', costoCentavos: 1_000_000 });
      await costos.guardarConfig(dueno.id, {
        extras: [{ nombre: 'Ganancia', modo: 'porcentaje', valor: 50 }],
        redondeoCentavos: 0,
        estimativo: true,
        vigenciaDias: 7,
        desgloseAlCliente: 'total',
      });
      await prisma.producto.update({
        where: { id: productoId },
        data: {
          solicitud: PREGUNTAS,
          receta: { renglones: [{ insumoId: melamina.id, cantidad: 'ancho ÷ 100' }], extras: [] },
          politicaCotizacion: politica,
        },
      });
      return melamina;
    }

    const respuestas = [{ pregunta: 'Ancho (cm)', respuesta: '120' }];

    it('automática: arma el presupuesto, queda cotizado y devuelve el texto para el cliente', async () => {
      await conReceta('automatica');
      const previa = await pedidos.cotizacionPrevia(dueno.id, productoId, respuestas);
      expect(previa?.resultado).toMatchObject({ ok: true, totalCentavos: 1_800_000 });
      const resultado = await solicitar('120');
      const cotizacion = await pedidos.cotizarSolicitud(resultado, previa);
      expect(cotizacion).toMatchObject({ modo: 'automatica' });
      expect(cotizacion.modo === 'automatica' && cotizacion.texto).toContain('*Total: $ 18.000* (es estimativo');
      expect(cotizacion.modo === 'automatica' && cotizacion.texto).toContain('Vale por 7 días.');
      // El desglose (y el costo de la melamina) no le llega al cliente.
      expect(cotizacion.modo === 'automatica' && cotizacion.texto).not.toContain('Melamina');
      const venta = await pedidos.buscar(dueno.id, resultado.venta.id);
      expect(venta).toMatchObject({ estado: 'cotizado', totalCentavos: 1_800_000 });
      expect(venta?.presupuestos).toMatchObject([{ origen: 'asistente', estado: 'enviado', estimativo: true }]);
      expect(notificaciones.avisarAlCliente).not.toHaveBeenCalled();
    });

    it('revisión: queda el borrador para el dueño y el pedido sigue a cotizar', async () => {
      await conReceta('revision');
      const previa = await pedidos.cotizacionPrevia(dueno.id, productoId, respuestas);
      const resultado = await solicitar('120');
      expect(await pedidos.cotizarSolicitud(resultado, previa)).toEqual({ modo: 'revision' });
      const venta = await pedidos.buscar(dueno.id, resultado.venta.id);
      expect(venta).toMatchObject({ estado: 'a_cotizar', totalCentavos: null });
      expect(venta?.presupuestos).toMatchObject([{ origen: 'asistente', estado: 'borrador', totalCentavos: 1_800_000 }]);
      expect(notificaciones.avisar).toHaveBeenCalledWith(dueno.id, expect.objectContaining({ tipo: 'presupuesto_a_revisar' }));
    });

    it('si la receta no alcanza (un insumo dado de baja), queda para el dueño con el motivo', async () => {
      const melamina = await conReceta('automatica');
      await costos.borrarInsumo(dueno.id, melamina.id);
      const previa = await pedidos.cotizacionPrevia(dueno.id, productoId, respuestas);
      expect(previa?.resultado).toMatchObject({ ok: false });
      const resultado = await solicitar('120');
      expect(await pedidos.cotizarSolicitud(resultado, previa)).toEqual({ modo: 'manual' });
      expect(notificaciones.avisar).toHaveBeenCalledWith(
        dueno.id,
        expect.objectContaining({ tipo: 'solicitud_a_cotizar', cuerpo: expect.stringContaining('no pudo cotizarlo solo') }),
      );
    });

    it('el dueño arma un borrador con la receta aunque el producto lo cotice él', async () => {
      await conReceta('manual');
      const { venta } = await solicitar('120');
      const conBorrador = await pedidos.presupuestoDesdeReceta(dueno.id, venta.id);
      expect(conBorrador?.presupuestos).toMatchObject([{ estado: 'borrador', totalCentavos: 1_800_000 }]);
      expect(await pedidos.presupuestoDesdeReceta(otro.id, venta.id)).toBeNull();
    });

    it('al guardar el producto la receta se valida contra los insumos y las preguntas', async () => {
      const melamina = await conReceta('manual');
      const ajeno = await prisma.insumo.create({
        data: { userId: otro.id, tipo: 'material', nombre: 'Ajeno', unidad: 'm', costoCentavos: 1 },
      });
      const productos = new ProductosService(prisma, { programar: vi.fn() } as unknown as IndexadorService);
      const base = { codigo: 'PLACARD', nombre: 'Placard', solicitud: PREGUNTAS };
      const guardar = (extra: Record<string, unknown>) => productos.actualizar(dueno.id, productoId, { ...base, ...extra } as never);

      const guardado = await guardar({
        receta: { renglones: [{ insumoId: melamina.id, cantidad: 'ancho ÷ 100' }] },
        politicaCotizacion: 'automatica',
      });
      expect(guardado).toMatchObject({ politicaCotizacion: 'automatica', receta: { renglones: [{ insumoId: melamina.id }] } });
      await expect(guardar({ receta: { renglones: [{ insumoId: ajeno.id, cantidad: '1' }] } })).rejects.toMatchObject({ status: 400 });
      await expect(guardar({ receta: { renglones: [{ insumoId: melamina.id, cantidad: 'largo' }] } })).rejects.toMatchObject({
        status: 400,
      });
      await expect(guardar({ receta: null, politicaCotizacion: 'automatica' })).rejects.toMatchObject({ status: 400 });
    });

    it('los costos son de cada comercio', async () => {
      await conReceta('manual');
      await expect(costos.obtener(otro.id)).rejects.toMatchObject({ status: 409 });
      expect((await costos.obtener(dueno.id)).insumos).toHaveLength(1);
      const [melamina] = (await costos.obtener(dueno.id)).insumos;
      await expect(costos.borrarInsumo(otro.id, melamina.id)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('versiones con precio fijo', () => {
    let roble: string;
    beforeEach(async () => {
      roble = (
        await prisma.variante.create({ data: { productoId, sku: 'PLACARD-ROBLE', nombre: 'Roble 2 puertas', precioCentavos: 9_000_000 } })
      ).id;
    });

    const pedir = (cantidad = 2) =>
      pedidos.pedirVariante({
        userId: dueno.id,
        conversationId,
        remoteJid,
        nombreCliente: 'Ana',
        varianteId: roble,
        cantidad,
        dePrueba: false,
      });

    it('tal cual sale cotizada a su precio y con el cobro, y el ítem es la variante', async () => {
      const venta = await pedir();
      // Sin Mercado Pago queda a coordinar, como cualquier presupuesto aceptado.
      expect(venta).toMatchObject({ tipo: 'a_medida', estado: 'pendiente_pago', medioPago: 'manual', totalCentavos: 18_000_000 });
      expect(venta.presupuestos).toHaveLength(1);
      expect(venta.presupuestos[0]).toMatchObject({ origen: 'asistente', estado: 'enviado', totalCentavos: 18_000_000 });
      expect(venta.items).toEqual([
        expect.objectContaining({ varianteId: roble, nombreVariante: 'Roble 2 puertas', cantidad: 2, precioUnitarioCentavos: 9_000_000 }),
      ]);
      expect(venta.solicitud).toMatchObject({ variante: { id: roble, cantidad: 2 }, cambios: null });

      // Pedirla igual otra vez devuelve el mismo pedido, no uno nuevo.
      expect((await pedir()).id).toBe(venta.id);
      expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(1);

      // Pagarla no toca stock: la variante no lo controla.
      await ventas.marcarPagada(venta.id);
      expect((await prisma.variante.findUniqueOrThrow({ where: { id: roble } })).stock).toBeNull();
    });

    it('sólo de un producto a medida activo de la cuenta', async () => {
      await expect(
        pedidos.pedirVariante({ userId: otro.id, conversationId, remoteJid, nombreCliente: 'Ana', varianteId: roble, cantidad: 1, dePrueba: false }),
      ).rejects.toBeInstanceOf(PedidoRechazadoError);
      await prisma.producto.update({ where: { id: productoId }, data: { solicitud: Prisma.DbNull } });
      await expect(pedir()).rejects.toThrow(/ya no está en el catálogo/);
    });

    it('con cambios queda para cotizar, con la base y lo que cambia; otros cambios la reabren', async () => {
      const base = { id: roble, nombre: 'Roble 2 puertas', precioCentavos: 9_000_000, cantidad: 1 };
      const pedirCon = (cambios: string) =>
        pedidos.registrarSolicitud({
          userId: dueno.id,
          conversationId,
          remoteJid,
          nombreCliente: 'Ana',
          producto: { id: productoId, nombre: 'Placard' },
          respuestas: [],
          resumen: 'El de roble pero más alto',
          variante: base,
          cambios,
          dePrueba: false,
        });
      // La misma versión pedida tal cual antes sigue esperando su pago: la solicitud es otro pedido.
      const tal = await pedir(1);
      const { venta } = await pedirCon('de 2,40 m de alto');
      expect(venta.id).not.toBe(tal.id);
      expect((await prisma.venta.findUniqueOrThrow({ where: { id: tal.id } })).estado).toBe('pendiente_pago');
      expect(venta).toMatchObject({ estado: 'a_cotizar', totalCentavos: null });
      expect(venta.solicitud).toMatchObject({ variante: { id: roble }, cambios: 'de 2,40 m de alto' });
      expect((await pedirCon('de 2,40 m de alto')).cambio).toBe(false);
      expect((await pedirCon('de 2,60 m de alto')).cambio).toBe(true);
    });
  });
});
