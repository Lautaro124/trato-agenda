import { ConflictException, Injectable } from '@nestjs/common';
import type { Moneda } from '../comercio/catalogo.rules.js';
import { rangoDeDias, type Rango } from '../comercio/historico.rules.js';
import { claveDia } from '../conversation/graph/agenda-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ETAPAS, type Etapa } from './etapas.rules.js';
import {
  cobertura,
  DEFINICIONES,
  estadoDeChat,
  etapaDondeCortan,
  MAX_PRODUCTOS_PERFORMANCE,
  rangoAnterior,
  tasa,
} from './lectura.rules.js';
import type {
  ConteosConversion,
  EtapaPublica,
  FiltrosPerformanceQuery,
  PerformancePublica,
  ProductoPerformance,
} from './performance.types.js';

/** Etapas que cuentan como "hizo un pedido". */
const CON_PEDIDO: Etapa[] = ['pedido', 'cotizado', 'pagado'];

/**
 * Lectura del módulo de performance (LAU-30): conversión, etapas y
 * productos de los chats nuevos de un período. Sólo para cuentas de ventas
 * (409 si no) y todo por `userId`; nada de lo que devuelve identifica a un
 * cliente. Definiciones en docs/performance.md.
 */
@Injectable()
export class LecturaPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async leer(userId: string, filtros: FiltrosPerformanceQuery, ahora: Date = new Date()): Promise<PerformancePublica> {
    const rango = rangoDeDias(filtros.desde, filtros.hasta, ahora);
    const moneda = filtros.moneda ?? 'ARS';
    await this.exigirVentas(userId);

    const primero = await this.prisma.etapaChat.aggregate({ where: { userId }, _min: { createdAt: true } });
    const primerRegistro = primero._min.createdAt;
    const datos = cobertura(rango, primerRegistro);
    const anterior = rangoAnterior(rango);

    const [conteos, conteosAnteriores, etapas, productos] = await Promise.all([
      this.conversion(userId, rango, moneda),
      cobertura(anterior, primerRegistro) === 'sin_datos' ? null : this.conversion(userId, anterior, moneda),
      this.etapas(userId, rango, ahora),
      this.productos(userId, rango, moneda),
    ]);

    return {
      moneda,
      rango: { primerDia: rango.primerDia, ultimoDia: rango.ultimoDia },
      datos,
      registroDesde: primerRegistro ? claveDia(primerRegistro) : null,
      definiciones: DEFINICIONES,
      conversion: { ...conTasas(conteos), anterior: conteosAnteriores ? conTasas(conteosAnteriores) : null },
      etapas,
      productos,
    };
  }

  private async conversion(userId: string, rango: Rango, moneda: Moneda): Promise<ConteosConversion> {
    const [[chats], [ventas]] = await Promise.all([
      this.prisma.$queryRaw<Array<{ chats: number; conPedido: number; conPago: number }>>`
        SELECT COUNT(*)::int AS "chats",
               COUNT(*) FILTER (WHERE e."etapa" IN (${CON_PEDIDO[0]}, ${CON_PEDIDO[1]}, ${CON_PEDIDO[2]}))::int AS "conPedido",
               COUNT(*) FILTER (WHERE e."etapa" = 'pagado')::int AS "conPago"
        FROM "EtapaChat" e
        WHERE e."userId" = ${userId} AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta}
      `,
      this.prisma.$queryRaw<Array<{ pedidos: number; pagados: number }>>`
        SELECT COUNT(*)::int AS "pedidos", COUNT(*) FILTER (WHERE v."estado" = 'pagada')::int AS "pagados"
        FROM "Venta" v JOIN "EtapaChat" e ON e."conversationId" = v."conversationId"
        WHERE v."userId" = ${userId} AND e."userId" = ${userId} AND NOT v."dePrueba" AND v."moneda" = ${moneda}
          AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta}
      `,
    ]);
    return { chats: chats.chats, conPedido: chats.conPedido, pedidos: ventas.pedidos, pagados: ventas.pagados, conPago: chats.conPago };
  }

  private async etapas(userId: string, rango: Rango, ahora: Date): Promise<EtapaPublica[]> {
    const filas = await this.prisma.etapaChat.findMany({
      where: { userId, createdAt: { gte: rango.desde, lt: rango.hasta } },
      select: { etapa: true, ultimaActividadAt: true, derivado: true },
    });
    const porEtapa = new Map<Etapa, EtapaPublica>(
      ETAPAS.map((etapa) => [etapa, { etapa, total: 0, activos: 0, estancados: 0, abandonados: 0, derivados: 0 }]),
    );
    for (const fila of filas) {
      const etapa = porEtapa.get(fila.etapa as Etapa);
      if (!etapa) continue;
      etapa.total += 1;
      if (fila.derivado) etapa.derivados += 1;
      const estado = estadoDeChat(etapa.etapa, fila.ultimaActividadAt, ahora);
      if (estado === 'activo') etapa.activos += 1;
      else if (estado === 'estancado') etapa.estancados += 1;
      else if (estado === 'abandonado') etapa.abandonados += 1;
    }
    return [...porEtapa.values()];
  }

  private async productos(userId: string, rango: Rango, moneda: Moneda): Promise<ProductoPerformance[]> {
    const [intereses, pagos, cortes] = await Promise.all([
      // Una fila desligada (sin conversación, pasados los 12 meses) cuenta por su propia fecha.
      this.prisma.$queryRaw<Array<{ productoId: string; tipo: string; chats: number }>>`
        SELECT i."productoId", i."tipo", COUNT(*)::int AS "chats"
        FROM "InteresProducto" i LEFT JOIN "EtapaChat" e ON e."conversationId" = i."conversationId" AND e."userId" = ${userId}
        WHERE i."userId" = ${userId}
          AND CASE WHEN i."conversationId" IS NULL
                   THEN i."createdAt" >= ${rango.desde} AND i."createdAt" < ${rango.hasta}
                   ELSE e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} END
        GROUP BY 1, 2
      `,
      // Lo de stock sale de los renglones (por variante); lo a medida, del producto de la solicitud.
      this.prisma.$queryRaw<Array<{ productoId: string; pagaron: number; unidades: number; cobrado: number }>>`
        WITH pagadas AS (
          SELECT v."id", v."tipo", v."conversationId", v."solicitud", v."totalCentavos"
          FROM "Venta" v JOIN "EtapaChat" e ON e."conversationId" = v."conversationId"
          WHERE v."userId" = ${userId} AND e."userId" = ${userId} AND v."estado" = 'pagada' AND NOT v."dePrueba"
            AND v."moneda" = ${moneda} AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta}
        )
        SELECT x."productoId", COUNT(DISTINCT x."conversationId")::int AS "pagaron",
               SUM(x."unidades")::int AS "unidades", SUM(x."cobrado")::int AS "cobrado"
        FROM (
          SELECT va."productoId", p."conversationId", i."cantidad" AS "unidades", i."subtotalCentavos" AS "cobrado"
          FROM pagadas p JOIN "ItemVenta" i ON i."ventaId" = p."id" JOIN "Variante" va ON va."id" = i."varianteId"
          WHERE p."tipo" = 'stock'
          UNION ALL
          SELECT p."solicitud"->>'productoId', p."conversationId",
                 COALESCE((SELECT SUM(i."cantidad") FROM "ItemVenta" i WHERE i."ventaId" = p."id"), 1), COALESCE(p."totalCentavos", 0)
          FROM pagadas p
          WHERE p."tipo" = 'a_medida' AND p."solicitud"->>'productoId' IS NOT NULL
        ) x
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ productoId: string; etapa: string; chats: number }>>`
        SELECT i."productoId", e."etapa", COUNT(*)::int AS "chats"
        FROM "InteresProducto" i JOIN "EtapaChat" e ON e."conversationId" = i."conversationId"
        WHERE i."userId" = ${userId} AND e."userId" = ${userId} AND i."tipo" = 'vio' AND e."etapa" <> 'pagado'
          AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta}
        GROUP BY 1, 2
      `,
    ]);

    type Acumulado = { vieron: number; pidieron: number; pagaron: number; unidades: number; cobrado: number; cortes: Partial<Record<Etapa, number>> };
    const porProducto = new Map<string, Acumulado>();
    const de = (productoId: string) => {
      let acumulado = porProducto.get(productoId);
      if (!acumulado) {
        acumulado = { vieron: 0, pidieron: 0, pagaron: 0, unidades: 0, cobrado: 0, cortes: {} };
        porProducto.set(productoId, acumulado);
      }
      return acumulado;
    };
    for (const fila of intereses) {
      if (fila.tipo === 'vio') de(fila.productoId).vieron += fila.chats;
      else if (fila.tipo === 'pidio') de(fila.productoId).pidieron += fila.chats;
    }
    for (const fila of pagos) {
      const acumulado = de(fila.productoId);
      acumulado.pagaron += fila.pagaron;
      acumulado.unidades += fila.unidades;
      acumulado.cobrado += fila.cobrado;
    }
    for (const fila of cortes) {
      if ((ETAPAS as readonly string[]).includes(fila.etapa)) de(fila.productoId).cortes[fila.etapa as Etapa] = fila.chats;
    }
    if (porProducto.size === 0) return [];

    // Sólo productos de la cuenta: un id que no es suyo (una solicitud vieja, un producto ajeno) no sale.
    const datos = await this.prisma.producto.findMany({
      where: { userId, id: { in: [...porProducto.keys()] } },
      select: { id: true, codigo: true, nombre: true, solicitud: true },
    });
    return datos
      .map((producto): ProductoPerformance => {
        const acumulado = porProducto.get(producto.id) as Acumulado;
        return {
          productoId: producto.id,
          codigo: producto.codigo,
          nombre: producto.nombre,
          aMedida: producto.solicitud !== null,
          vieron: acumulado.vieron,
          pidieron: acumulado.pidieron,
          pagaron: acumulado.pagaron,
          vioAPidio: tasa(acumulado.pidieron, acumulado.vieron),
          pidioAPago: tasa(acumulado.pagaron, acumulado.pidieron),
          unidades: acumulado.unidades,
          cobradoCentavos: acumulado.cobrado,
          cortanEn: etapaDondeCortan(acumulado.cortes),
        };
      })
      .sort((a, b) => b.vieron - a.vieron || b.pidieron - a.pidieron || b.pagaron - a.pagaron || a.nombre.localeCompare(b.nombre))
      .slice(0, MAX_PRODUCTOS_PERFORMANCE);
  }

  private async exigirVentas(userId: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { tipoAsistente: true } });
    if (!agent || agent.tipoAsistente !== 'ventas') {
      throw new ConflictException('El rendimiento de productos es para las cuentas que venden.');
    }
  }
}

function conTasas(conteos: ConteosConversion) {
  return {
    ...conteos,
    chatAPedido: tasa(conteos.conPedido, conteos.chats),
    pedidoAPago: tasa(conteos.pagados, conteos.pedidos),
    chatAPago: tasa(conteos.conPago, conteos.chats),
  };
}
