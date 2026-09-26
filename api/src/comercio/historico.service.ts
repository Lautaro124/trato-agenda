import { Injectable } from '@nestjs/common';
import { TIMEZONE } from '../conversation/graph/agenda-rules.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { diasEntre, MAX_FILAS_CSV, rangoDeDias, ventasACsv, type Rango } from './historico.rules.js';
import type { EstadoVenta } from './ventas.rules.js';
import { aVentaPublica, type VentaPublica } from './ventas.types.js';

export const VENTAS_POR_PAGINA = 25;

/** Productos del ranking de más vendidos. */
const TOP_PRODUCTOS = 10;

export type FiltrosHistorico = {
  desde?: string;
  hasta?: string;
  estado?: EstadoVenta;
  /** Busca en el nombre o teléfono del cliente y en el nombre o código de los productos. */
  q?: string;
  /** Los pedidos del banco de pruebas no cuentan salvo que se pidan. */
  incluirPrueba?: boolean;
  pagina?: number;
};

export type TotalesHistorico = {
  /** Lo cobrado: ventas pagadas del período. */
  cobradoCentavos: number;
  pagadas: number;
  ticketPromedioCentavos: number;
  /** Lo que está reservado esperando pago (pendientes vigentes). */
  pendienteCentavos: number;
  pendientes: number;
};

export type ListadoVentas = {
  ventas: VentaPublica[];
  total: number;
  pagina: number;
  porPagina: number;
  totales: TotalesHistorico;
  rango: { primerDia: string; ultimoDia: string };
};

export type ResumenVentas = {
  rango: { primerDia: string; ultimoDia: string };
  /** Un punto por día del rango, con cero los días sin ventas. */
  porDia: Array<{ dia: string; cobradoCentavos: number; ventas: number }>;
  topProductos: Array<{ codigo: string; nombreProducto: string; unidades: number; cobradoCentavos: number }>;
};

/**
 * El histórico de ventas del dueño: listado con filtros y totales, resumen
 * por día y más vendidos, y el export CSV. Los períodos van por la fecha del
 * pedido (`createdAt`) en la zona del negocio; los montos "cobrados" son los
 * de las ventas pagadas de ese período.
 */
@Injectable()
export class HistoricoVentasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(userId: string, filtros: FiltrosHistorico, ahora: Date = new Date()): Promise<ListadoVentas> {
    const rango = rangoDeDias(filtros.desde, filtros.hasta, ahora);
    const pagina = filtros.pagina ?? 1;
    const where = this.where(userId, rango, filtros, ahora);
    // Los totales son del período, como los gráficos: la búsqueda y el estado
    // sólo recortan el listado.
    const base = this.where(userId, rango, { incluirPrueba: filtros.incluirPrueba }, ahora);

    const [ventas, total, pagadas, pendientes] = await Promise.all([
      this.prisma.venta.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * VENTAS_POR_PAGINA,
        take: VENTAS_POR_PAGINA,
      }),
      this.prisma.venta.count({ where }),
      this.prisma.venta.aggregate({
        where: { AND: [base, { estado: 'pagada' }] },
        _sum: { totalCentavos: true },
        _count: { _all: true },
      }),
      this.prisma.venta.aggregate({
        where: { AND: [base, { estado: 'pendiente_pago', reservaVenceAt: { gt: ahora } }] },
        _sum: { totalCentavos: true },
        _count: { _all: true },
      }),
    ]);

    const cobrado = pagadas._sum.totalCentavos ?? 0;
    return {
      ventas: ventas.map((venta) => aVentaPublica(venta, ahora)),
      total,
      pagina,
      porPagina: VENTAS_POR_PAGINA,
      rango: { primerDia: rango.primerDia, ultimoDia: rango.ultimoDia },
      totales: {
        cobradoCentavos: cobrado,
        pagadas: pagadas._count._all,
        ticketPromedioCentavos: pagadas._count._all > 0 ? Math.round(cobrado / pagadas._count._all) : 0,
        pendienteCentavos: pendientes._sum.totalCentavos ?? 0,
        pendientes: pendientes._count._all,
      },
    };
  }

  async resumen(userId: string, filtros: Pick<FiltrosHistorico, 'desde' | 'hasta' | 'incluirPrueba'>, ahora: Date = new Date()): Promise<ResumenVentas> {
    const rango = rangoDeDias(filtros.desde, filtros.hasta, ahora);
    const incluirPrueba = filtros.incluirPrueba ?? false;

    const [porDia, top] = await Promise.all([
      this.prisma.$queryRaw<Array<{ dia: string; cobrado: number; ventas: number }>>`
        SELECT to_char(v."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS "dia",
               SUM(v."totalCentavos")::int AS "cobrado", COUNT(*)::int AS "ventas"
        FROM "Venta" v
        WHERE v."userId" = ${userId} AND v."estado" = 'pagada'
          AND v."createdAt" >= ${rango.desde} AND v."createdAt" < ${rango.hasta}
          AND (${incluirPrueba} OR NOT v."dePrueba")
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ codigo: string; nombreProducto: string; unidades: number; cobrado: number }>>`
        SELECT i."codigo", MAX(i."nombreProducto") AS "nombreProducto",
               SUM(i."cantidad")::int AS "unidades", SUM(i."subtotalCentavos")::int AS "cobrado"
        FROM "ItemVenta" i JOIN "Venta" v ON v."id" = i."ventaId"
        WHERE v."userId" = ${userId} AND v."estado" = 'pagada'
          AND v."createdAt" >= ${rango.desde} AND v."createdAt" < ${rango.hasta}
          AND (${incluirPrueba} OR NOT v."dePrueba")
        GROUP BY i."codigo"
        ORDER BY "cobrado" DESC, "unidades" DESC, i."codigo"
        LIMIT ${TOP_PRODUCTOS}
      `,
    ]);

    const porClave = new Map(porDia.map((fila) => [fila.dia, fila]));
    return {
      rango: { primerDia: rango.primerDia, ultimoDia: rango.ultimoDia },
      porDia: diasEntre(rango.primerDia, rango.ultimoDia).map((dia) => ({
        dia,
        cobradoCentavos: porClave.get(dia)?.cobrado ?? 0,
        ventas: porClave.get(dia)?.ventas ?? 0,
      })),
      topProductos: top.map((fila) => ({
        codigo: fila.codigo,
        nombreProducto: fila.nombreProducto,
        unidades: fila.unidades,
        cobradoCentavos: fila.cobrado,
      })),
    };
  }

  async exportarCsv(userId: string, filtros: FiltrosHistorico, ahora: Date = new Date()): Promise<string> {
    const rango = rangoDeDias(filtros.desde, filtros.hasta, ahora);
    const ventas = await this.prisma.venta.findMany({
      where: this.where(userId, rango, filtros, ahora),
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_FILAS_CSV,
    });
    return ventasACsv(ventas, ahora);
  }

  async obtener(userId: string, id: string, ahora: Date = new Date()): Promise<VentaPublica | null> {
    const venta = await this.prisma.venta.findFirst({ where: { id, userId }, include: { items: true } });
    return venta ? aVentaPublica(venta, ahora) : null;
  }

  private where(userId: string, rango: Rango, filtros: FiltrosHistorico, ahora: Date): Prisma.VentaWhereInput {
    const condiciones: Prisma.VentaWhereInput[] = [
      { userId, createdAt: { gte: rango.desde, lt: rango.hasta } },
    ];
    if (!filtros.incluirPrueba) condiciones.push({ dePrueba: false });

    // El estado que se ve: una pendiente con la reserva vencida ya es "vencida",
    // aunque el barrido todavía no la haya marcado.
    switch (filtros.estado) {
      case 'pendiente_pago':
        condiciones.push({ estado: 'pendiente_pago', reservaVenceAt: { gt: ahora } });
        break;
      case 'vencida':
        condiciones.push({ OR: [{ estado: 'vencida' }, { estado: 'pendiente_pago', reservaVenceAt: { lte: ahora } }] });
        break;
      case 'pagada':
      case 'cancelada':
        condiciones.push({ estado: filtros.estado });
        break;
    }

    const q = filtros.q?.trim();
    if (q) {
      const digitos = q.replace(/\D/g, '');
      condiciones.push({
        OR: [
          { nombreCliente: { contains: q, mode: 'insensitive' } },
          ...(digitos.length >= 4 ? [{ telefonoCliente: { contains: digitos } }] : []),
          { items: { some: { nombreProducto: { contains: q, mode: 'insensitive' } } } },
          { items: { some: { codigo: { equals: q, mode: 'insensitive' } } } },
        ],
      });
    }
    return { AND: condiciones };
  }
}
