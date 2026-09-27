/** Histórico contra Postgres real: filtros, totales, agrupado por día en la zona del negocio y ranking. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { HistoricoVentasService } from './historico.service.js';

const AHORA = new Date('2026-09-26T18:00:00Z');

describe.skipIf(!hayBaseDePrueba)('histórico de ventas (Postgres real)', () => {
  let prisma: PrismaService;
  let historico: HistoricoVentasService;
  let dueno: User;
  let otro: User;

  const venta = (userId: string, datos: {
    creada: string;
    estado: string;
    total: number;
    cliente?: string;
    dePrueba?: boolean;
    venceEn?: string;
    items?: Array<{ codigo: string; nombreProducto: string; cantidad: number; subtotal: number }>;
  }) =>
    prisma.venta.create({
      data: {
        userId,
        estado: datos.estado,
        medioPago: 'mercadopago',
        totalCentavos: datos.total,
        nombreCliente: datos.cliente ?? 'Juan',
        telefonoCliente: '5491122334455',
        dePrueba: datos.dePrueba ?? false,
        createdAt: new Date(datos.creada),
        reservaVenceAt: new Date(datos.venceEn ?? datos.creada),
        pagadaAt: datos.estado === 'pagada' ? new Date(datos.creada) : null,
        items: {
          create: (datos.items ?? [{ codigo: 'MATE', nombreProducto: 'Mate', cantidad: 1, subtotal: datos.total }]).map((item) => ({
            codigo: item.codigo,
            nombreProducto: item.nombreProducto,
            cantidad: item.cantidad,
            precioUnitarioCentavos: item.subtotal / item.cantidad,
            subtotalCentavos: item.subtotal,
          })),
        },
      },
    });

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    historico = new HistoricoVentasService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otro = await crearUsuarioDePrueba(prisma);

    // 25/9 a las 23:30 en Buenos Aires es 26/9 en UTC: tiene que contar para el 25.
    await venta(dueno.id, { creada: '2026-09-26T02:30:00Z', estado: 'pagada', total: 1_000_000, cliente: 'Ana' });
    await venta(dueno.id, {
      creada: '2026-09-26T15:00:00Z',
      estado: 'pagada',
      total: 3_000_000,
      items: [
        { codigo: 'TERMO', nombreProducto: 'Termo', cantidad: 1, subtotal: 2_000_000 },
        { codigo: 'MATE', nombreProducto: 'Mate', cantidad: 2, subtotal: 1_000_000 },
      ],
    });
    // Pendiente vigente, pendiente vencida sin barrer, cancelada, de prueba y de otro dueño.
    await venta(dueno.id, { creada: '2026-09-26T17:50:00Z', estado: 'pendiente_pago', total: 500_000, venceEn: '2026-09-26T18:20:00Z' });
    await venta(dueno.id, { creada: '2026-09-26T10:00:00Z', estado: 'pendiente_pago', total: 700_000, venceEn: '2026-09-26T10:30:00Z' });
    await venta(dueno.id, { creada: '2026-09-24T12:00:00Z', estado: 'cancelada', total: 900_000, cliente: '=cmd' });
    await venta(dueno.id, { creada: '2026-09-26T12:00:00Z', estado: 'pagada', total: 99_900_000, dePrueba: true });
    await venta(otro.id, { creada: '2026-09-26T12:00:00Z', estado: 'pagada', total: 12_300_000 });
    // Fuera del rango por defecto (más de 30 días).
    await venta(dueno.id, { creada: '2026-07-01T12:00:00Z', estado: 'pagada', total: 5_000_000 });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otro.id] } } });
    await prisma.$disconnect();
  });

  it('lista las del período, sin las de prueba ni las de otro dueño, con los totales', async () => {
    const listado = await historico.listar(dueno.id, {}, AHORA);
    expect(listado.total).toBe(5);
    expect(listado.totales).toEqual({
      cobradoCentavos: 4_000_000,
      pagadas: 2,
      ticketPromedioCentavos: 2_000_000,
      pendienteCentavos: 500_000,
      pendientes: 1,
    });
    // La pendiente con la reserva pasada ya se ve como vencida.
    expect(listado.ventas.map((v) => v.estado).sort()).toEqual(['cancelada', 'pagada', 'pagada', 'pendiente_pago', 'vencida']);
  });

  it('filtra por estado visible, por búsqueda y deja ver las de prueba si se pide', async () => {
    expect((await historico.listar(dueno.id, { estado: 'vencida' }, AHORA)).total).toBe(1);
    expect((await historico.listar(dueno.id, { estado: 'pendiente_pago' }, AHORA)).total).toBe(1);
    const termo = await historico.listar(dueno.id, { q: 'termo', estado: 'pagada' }, AHORA);
    expect(termo.total).toBe(1);
    // Los totales siguen siendo los del período entero.
    expect(termo.totales.pagadas).toBe(2);
    expect((await historico.listar(dueno.id, { q: 'ana' }, AHORA)).total).toBe(1);
    expect((await historico.listar(dueno.id, { q: '2233' }, AHORA)).total).toBe(5);
    expect((await historico.listar(dueno.id, { incluirPrueba: true }, AHORA)).totales.pagadas).toBe(3);
    expect((await historico.listar(dueno.id, { desde: '2026-07-01', hasta: '2026-07-01' }, AHORA)).total).toBe(1);
  });

  it('agrupa lo cobrado por día de Buenos Aires y rellena con cero', async () => {
    const resumen = await historico.resumen(dueno.id, { desde: '2026-09-24', hasta: '2026-09-26' }, AHORA);
    expect(resumen.porDia).toEqual([
      { dia: '2026-09-24', cobradoCentavos: 0, ventas: 0 },
      { dia: '2026-09-25', cobradoCentavos: 1_000_000, ventas: 1 },
      { dia: '2026-09-26', cobradoCentavos: 3_000_000, ventas: 1 },
    ]);
  });

  it('rankea los productos más vendidos por lo cobrado', async () => {
    const { topProductos } = await historico.resumen(dueno.id, {}, AHORA);
    expect(topProductos).toEqual([
      { codigo: 'MATE', nombreProducto: 'Mate', unidades: 3, cobradoCentavos: 2_000_000 },
      { codigo: 'TERMO', nombreProducto: 'Termo', unidades: 1, cobradoCentavos: 2_000_000 },
    ]);
  });

  it('exporta el CSV con los mismos filtros y neutraliza fórmulas', async () => {
    const csv = await historico.exportarCsv(dueno.id, { estado: 'cancelada' }, AHORA);
    const filas = csv.trim().split('\r\n');
    expect(filas).toHaveLength(2);
    expect(filas[1]).toContain(";'=cmd;");
  });

  it('una venta ajena no se ve', async () => {
    const ajena = await prisma.venta.findFirstOrThrow({ where: { userId: otro.id } });
    expect(await historico.obtener(dueno.id, ajena.id)).toBeNull();
  });
});
