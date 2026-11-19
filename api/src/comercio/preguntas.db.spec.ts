/**
 * Preguntas del pedido (LAU-100) contra Postgres real: la configuración de la
 * cuenta, la verificación de productos e imágenes propios y lo que queda
 * guardado en el pedido (respuestas y notas). Ver test/base-de-prueba.ts.
 */
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { RegistroPerformanceService } from '../performance/registro.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';
import type { MercadoPagoClient } from '../subscription/mercadopago.client.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { leerNotas, leerRespuestas } from './preguntas-pedido.rules.js';
import { PreguntasService } from './preguntas.service.js';
import { PedidoRechazadoError, VentasService } from './ventas.service.js';

const config = { get: () => '' } as unknown as ConfigService<Env, true>;

describe.skipIf(!hayBaseDePrueba)('preguntas del pedido (Postgres real)', () => {
  let prisma: PrismaService;
  let dueno: User;
  let otro: User;
  let sillon: string;
  let mesa: string;
  let ajeno: string;
  let preguntas: PreguntasService;
  let ventas: VentasService;

  const formulario = (productoSillon: string) => [
    {
      id: 'aclaracion',
      texto: '¿Querés agregar algo más?',
      tipo: 'texto',
      obligatoria: false,
      alcance: 'global',
    },
    {
      id: 'tela',
      texto: '¿Qué tela querés?',
      tipo: 'opciones',
      obligatoria: true,
      alcance: 'producto',
      productos: [productoSillon],
      opciones: [
        { id: 'lino', texto: 'Lino' },
        { id: 'pana', texto: 'Pana' },
      ],
    },
    {
      id: 'color',
      texto: '¿Qué color querés?',
      tipo: 'opciones',
      obligatoria: true,
      dependeDe: { preguntaId: 'tela', siRespuestas: [] },
      opciones: [
        { id: 'verde', texto: 'Verde', soloSi: ['lino'] },
        { id: 'rojo', texto: 'Rojo', soloSi: ['lino'] },
        { id: 'gris', texto: 'Gris', soloSi: ['pana'] },
      ],
      otra: { etiqueta: 'Personalizar' },
    },
  ];

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    preguntas = new PreguntasService(prisma);
    ventas = new VentasService(
      prisma,
      { crearPreferencia: vi.fn() } as unknown as MercadoPagoClient,
      { tokenDe: vi.fn() } as unknown as CuentaMercadoPagoService,
      config,
      { avisar: vi.fn(), avisarAlCliente: vi.fn() } as unknown as NotificacionesService,
      new RegistroPerformanceService(prisma),
      { asistenteActivo: vi.fn() } as unknown as SubscriptionService,
      { puedeEscribir: vi.fn() } as unknown as HorarioAtencionService,
    );
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);
    const crear = (userId: string, codigo: string) =>
      prisma.producto.create({ data: { userId, codigo, nombre: `Producto ${codigo}`, precioCentavos: 100_000, stock: 10 } });
    sillon = (await crear(dueno.id, 'SILLON')).id;
    mesa = (await crear(dueno.id, 'MESA')).id;
    ajeno = (await crear(otro.id, 'AJENO')).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('guarda las preguntas normalizadas y las devuelve', async () => {
    const guardadas = await preguntas.guardar(dueno.id, formulario(sillon));
    expect(guardadas.map((pregunta) => pregunta.id)).toEqual(['aclaracion', 'tela', 'color']);
    // La dependiente hereda los productos de la anterior.
    expect(guardadas[2].productos).toEqual([sillon]);
    expect(await preguntas.obtener(dueno.id)).toEqual(guardadas);
  });

  it('no deja asignar productos ni imágenes de otra cuenta', async () => {
    await expect(preguntas.guardar(dueno.id, formulario(ajeno))).rejects.toThrow('ya no está en el catálogo');
    const conImagenAjena = formulario(sillon);
    const imagenAjena = await prisma.imagenPregunta.create({
      data: { userId: otro.id, datos: new Uint8Array([1, 2, 3]), bytes: 3, ancho: 1, alto: 1 },
    });
    (conImagenAjena[0] as Record<string, unknown>).imagenId = imagenAjena.id;
    await expect(preguntas.guardar(dueno.id, conImagenAjena)).rejects.toThrow('Alguna imagen ya no está');
  });

  it('el pedido guarda la respuesta de opciones en el renglón y el pedido especial y el texto libre como notas', async () => {
    await preguntas.guardar(dueno.id, formulario(sillon));
    const venta = await ventas.crearPedido({
      userId: dueno.id,
      conversationId: null,
      remoteJid: '5491122334455@s.whatsapp.net',
      nombreCliente: 'Ana',
      items: [
        { productoId: sillon, cantidad: 1 },
        { productoId: mesa, cantidad: 1 },
      ],
      medioPago: 'manual',
      respuestas: [
        { preguntaId: 'tela', respuesta: 'lino' },
        { preguntaId: 'color', respuesta: 'Naranja' },
        { preguntaId: 'aclaracion', respuesta: 'Es para regalo' },
      ],
    });
    const renglonSillon = venta.items.find((item) => item.productoId === sillon);
    const renglonMesa = venta.items.find((item) => item.productoId === mesa);
    expect(leerRespuestas(renglonSillon?.respuestas)).toEqual([{ pregunta: '¿Qué tela querés?', respuesta: 'Lino' }]);
    expect(renglonMesa?.respuestas).toBeNull();
    expect(leerNotas(venta.notas)).toEqual([
      { tipo: 'texto', pregunta: '¿Querés agregar algo más?', respuesta: 'Es para regalo', producto: null, contexto: [] },
      {
        tipo: 'otra',
        pregunta: '¿Qué color querés?',
        respuesta: 'Naranja',
        producto: 'Producto SILLON',
        contexto: [{ pregunta: '¿Qué tela querés?', respuesta: 'Lino' }],
      },
    ]);
  });

  it('rechaza el pedido si falta una obligatoria de la rama elegida, sin reservar nada', async () => {
    const antes = await prisma.venta.count({ where: { userId: dueno.id } });
    await expect(
      ventas.crearPedido({
        userId: dueno.id,
        conversationId: null,
        remoteJid: null,
        nombreCliente: 'Ana',
        items: [{ productoId: sillon, cantidad: 1 }],
        medioPago: 'manual',
        respuestas: [{ preguntaId: 'tela', respuesta: 'Pana' }],
      }),
    ).rejects.toThrow(PedidoRechazadoError);
    expect(await prisma.venta.count({ where: { userId: dueno.id } })).toBe(antes);
  });

  it('borrar todas las preguntas libera las imágenes que ya no se usan (pasada la gracia)', async () => {
    const vieja = await prisma.imagenPregunta.create({
      data: { userId: dueno.id, datos: new Uint8Array([1]), bytes: 1, ancho: 1, alto: 1, createdAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const reciente = await prisma.imagenPregunta.create({
      data: { userId: dueno.id, datos: new Uint8Array([1]), bytes: 1, ancho: 1, alto: 1 },
    });
    await preguntas.guardar(dueno.id, []);
    const quedan = await prisma.imagenPregunta.findMany({ where: { userId: dueno.id }, select: { id: true } });
    expect(quedan.map((imagen) => imagen.id)).toEqual([reciente.id]);
    expect(quedan.some((imagen) => imagen.id === vieja.id)).toBe(false);
  });
});
