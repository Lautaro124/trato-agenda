import { ConflictException, Injectable } from '@nestjs/common';
import type { Moneda } from '../comercio/catalogo.rules.js';
import { Prisma } from '../generated/prisma/client.js';
import { rangoDeDias, type Rango } from '../comercio/historico.rules.js';
import { claveDia, TIMEZONE } from '../conversation/graph/agenda-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ETAPAS, type Etapa } from './etapas.rules.js';
import {
  cobertura,
  completarDias,
  DEFINICIONES,
  estadoDeChat,
  etapaDondeCortan,
  MAX_PRODUCTOS_PERFORMANCE,
  rangoAnterior,
  sumarDias,
  tasa,
} from './lectura.rules.js';
import { esTema, TEMAS, type Tema } from './preguntas.rules.js';
import type {
  ConteosConversion,
  Conversion,
  DiaPerformance,
  EtapaPublica,
  FiltroZona,
  FiltrosPerformanceQuery,
  PerformancePublica,
  PreguntasPerformance,
  ProductoPerformance,
  ZonaPerformance,
} from './performance.types.js';
import { SIN_ZONA, ZONAS, esZona } from './zona.rules.js';

/** La condición sobre EtapaChat (alias `e`) para filtrar por zona; vacía sin filtro. */
function condicionDeZona(zona: FiltroZona | null): Prisma.Sql {
  if (!zona) return Prisma.empty;
  return zona === SIN_ZONA ? Prisma.sql`AND e."provincia" IS NULL` : Prisma.sql`AND e."provincia" = ${zona}`;
}

/** Productos con preguntas que devuelve la lectura. */
const MAX_PRODUCTOS_CON_PREGUNTAS = 20;

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
    const zona = filtros.zona ?? null;
    await this.exigirVentas(userId);

    const primero = await this.prisma.etapaChat.aggregate({ where: { userId }, _min: { createdAt: true } });
    const primerRegistro = primero._min.createdAt;
    const datos = cobertura(rango, primerRegistro);
    const anterior = rangoAnterior(rango);
    const datosAnteriores = cobertura(anterior, primerRegistro);

    const [porDia, porDiaAnterior, etapas, productos, zonas, preguntas] = await Promise.all([
      this.porDia(userId, rango, moneda, zona),
      datosAnteriores === 'sin_datos' ? null : this.porDia(userId, anterior, moneda, zona),
      this.etapas(userId, rango, ahora, zona),
      this.productos(userId, rango, moneda, zona),
      this.zonas(userId, rango),
      this.preguntas(userId, rango, zona),
    ]);

    const conversion = conTasas(sumarDias(porDia));
    return {
      moneda,
      zona,
      rango: { primerDia: rango.primerDia, ultimoDia: rango.ultimoDia },
      datos,
      registroDesde: primerRegistro ? claveDia(primerRegistro) : null,
      definiciones: DEFINICIONES,
      conversion,
      porDia,
      anterior: {
        rango: { primerDia: anterior.primerDia, ultimoDia: anterior.ultimoDia },
        datos: datosAnteriores,
        conversion: porDiaAnterior ? conTasas(sumarDias(porDiaAnterior)) : null,
        porDia: porDiaAnterior,
      },
      etapas,
      productos,
      zonas,
      preguntas: { ...preguntas, chats: conversion.chats },
    };
  }

  /** Las preguntas de los chats nuevos del período (y de la zona, si se filtra). */
  private async preguntas(userId: string, rango: Rango, zona: FiltroZona | null): Promise<Omit<PreguntasPerformance, 'chats'>> {
    const deZona = condicionDeZona(zona);
    const cohorte = Prisma.sql`p."userId" = ${userId} AND e."userId" = ${userId}
      AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}`;
    const [[{ analizados }], temas, ejemplos, productos, quedan] = await Promise.all([
      this.prisma.$queryRaw<Array<{ analizados: number }>>`
        SELECT COUNT(*)::int AS "analizados" FROM "EtapaChat" e
        WHERE e."userId" = ${userId} AND e."clasificadaAt" IS NOT NULL
          AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}
      `,
      this.prisma.$queryRaw<Array<{ tema: string; total: number; sinResolver: number }>>`
        SELECT p."tema", COUNT(*)::int AS "total", COUNT(*) FILTER (WHERE NOT p."resuelta")::int AS "sinResolver"
        FROM "PreguntaChat" p JOIN "EtapaChat" e ON e."id" = p."etapaChatId"
        WHERE ${cohorte}
        GROUP BY 1
      `,
      // Hasta 3 por tema: primero las que quedaron sin resolver, después las más nuevas.
      this.prisma.$queryRaw<Array<{ tema: string; texto: string }>>`
        SELECT x."tema", x."texto" FROM (
          SELECT p."tema", p."texto",
                 ROW_NUMBER() OVER (PARTITION BY p."tema" ORDER BY p."resuelta" ASC, p."createdAt" DESC) AS "n"
          FROM "PreguntaChat" p JOIN "EtapaChat" e ON e."id" = p."etapaChatId"
          WHERE ${cohorte} AND p."texto" IS NOT NULL
        ) x
        WHERE x."n" <= 3
        ORDER BY x."tema", x."n"
      `,
      this.prisma.$queryRaw<Array<{ productoId: string; total: number; sinResolver: number; temaPrincipal: string }>>`
        SELECT p."productoId", COUNT(*)::int AS "total", COUNT(*) FILTER (WHERE NOT p."resuelta")::int AS "sinResolver",
               MODE() WITHIN GROUP (ORDER BY p."tema") AS "temaPrincipal"
        FROM "PreguntaChat" p JOIN "EtapaChat" e ON e."id" = p."etapaChatId"
        WHERE ${cohorte} AND p."productoId" IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC, 1
        LIMIT ${MAX_PRODUCTOS_CON_PREGUNTAS}
      `,
      this.prisma.$queryRaw<Array<{ etapa: string; tema: string; total: number }>>`
        SELECT p."etapa", p."tema", COUNT(*)::int AS "total"
        FROM "PreguntaChat" p JOIN "EtapaChat" e ON e."id" = p."etapaChatId"
        WHERE ${cohorte} AND p."etapa" <> 'pagado'
        GROUP BY 1, 2
        ORDER BY 3 DESC, 1, 2
      `,
    ]);

    const ejemplosDe = new Map<string, string[]>();
    for (const fila of ejemplos) ejemplosDe.set(fila.tema, [...(ejemplosDe.get(fila.tema) ?? []), fila.texto]);
    const tema = (valor: string): Tema => (esTema(valor) ? valor : 'otro');

    // Sólo productos de la cuenta, con su nombre de hoy.
    const nombres = new Map(
      (
        await this.prisma.producto.findMany({
          where: { userId, id: { in: productos.map((fila) => fila.productoId) } },
          select: { id: true, nombre: true },
        })
      ).map((producto) => [producto.id, producto.nombre]),
    );

    return {
      analizados,
      porTema: temas
        .map((fila) => ({
          tema: tema(fila.tema),
          nombre: TEMAS[tema(fila.tema)],
          total: fila.total,
          sinResolver: fila.sinResolver,
          ejemplos: ejemplosDe.get(fila.tema) ?? [],
        }))
        .sort((a, b) => b.total - a.total || b.sinResolver - a.sinResolver || a.nombre.localeCompare(b.nombre)),
      porProducto: productos.flatMap((fila) => {
        const nombre = nombres.get(fila.productoId);
        return nombre === undefined
          ? []
          : [{ productoId: fila.productoId, nombre, total: fila.total, sinResolver: fila.sinResolver, temaPrincipal: tema(fila.temaPrincipal) }];
      }),
      dondeSeQuedan: quedan.flatMap((fila) =>
        (ETAPAS as readonly string[]).includes(fila.etapa) ? [{ etapa: fila.etapa as Etapa, tema: tema(fila.tema), total: fila.total }] : [],
      ),
    };
  }

  /** Los chats nuevos del período por zona: cuántos, cuántos con zona inferida y cuántos pidieron y pagaron. */
  private async zonas(userId: string, rango: Rango): Promise<ZonaPerformance[]> {
    const filas = await this.prisma.$queryRaw<
      Array<{ zona: string | null; chats: number; inferidas: number; conPedido: number; conPago: number }>
    >`
      SELECT e."provincia" AS "zona", COUNT(*)::int AS "chats",
             COUNT(*) FILTER (WHERE e."origenZona" = 'inferida')::int AS "inferidas",
             COUNT(*) FILTER (WHERE e."etapa" IN (${CON_PEDIDO[0]}, ${CON_PEDIDO[1]}, ${CON_PEDIDO[2]}))::int AS "conPedido",
             COUNT(*) FILTER (WHERE e."etapa" = 'pagado')::int AS "conPago"
      FROM "EtapaChat" e
      WHERE e."userId" = ${userId} AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta}
      GROUP BY 1
    `;
    const porZona = new Map<FiltroZona, ZonaPerformance>();
    for (const fila of filas) {
      // Una provincia que no es de la lista (no debería pasar) cuenta como sin zona.
      const zona: FiltroZona = esZona(fila.zona) ? fila.zona : SIN_ZONA;
      const actual = porZona.get(zona) ?? {
        zona,
        nombre: zona === SIN_ZONA ? 'Sin zona' : ZONAS[zona],
        chats: 0,
        inferidas: 0,
        conPedido: 0,
        conPago: 0,
        chatAPedido: tasa(0, 0),
        chatAPago: tasa(0, 0),
      };
      actual.chats += fila.chats;
      actual.inferidas += zona === SIN_ZONA ? 0 : fila.inferidas;
      actual.conPedido += fila.conPedido;
      actual.conPago += fila.conPago;
      porZona.set(zona, actual);
    }
    return [...porZona.values()]
      .map((fila) => ({ ...fila, chatAPedido: tasa(fila.conPedido, fila.chats), chatAPago: tasa(fila.conPago, fila.chats) }))
      .sort((a, b) => Number(a.zona === SIN_ZONA) - Number(b.zona === SIN_ZONA) || b.chats - a.chats || a.nombre.localeCompare(b.nombre));
  }

  /**
   * Los conteos de conversión día por día, según el día en que cada chat
   * escribió por primera vez: el total del período es su suma.
   */
  private async porDia(userId: string, rango: Rango, moneda: Moneda, zona: FiltroZona | null): Promise<DiaPerformance[]> {
    const deZona = condicionDeZona(zona);
    const dia = Prisma.sql`to_char(e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD')`;
    const [chats, ventas] = await Promise.all([
      this.prisma.$queryRaw<Array<{ dia: string; chats: number; conPedido: number; conPago: number }>>`
        SELECT ${dia} AS "dia", COUNT(*)::int AS "chats",
               COUNT(*) FILTER (WHERE e."etapa" IN (${CON_PEDIDO[0]}, ${CON_PEDIDO[1]}, ${CON_PEDIDO[2]}))::int AS "conPedido",
               COUNT(*) FILTER (WHERE e."etapa" = 'pagado')::int AS "conPago"
        FROM "EtapaChat" e
        WHERE e."userId" = ${userId} AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ dia: string; pedidos: number; pagados: number; cobrado: bigint }>>`
        SELECT ${dia} AS "dia", COUNT(*)::int AS "pedidos", COUNT(*) FILTER (WHERE v."estado" = 'pagada')::int AS "pagados",
               COALESCE(SUM(v."totalCentavos") FILTER (WHERE v."estado" = 'pagada'), 0)::bigint AS "cobrado"
        FROM "Venta" v JOIN "EtapaChat" e ON e."conversationId" = v."conversationId"
        WHERE v."userId" = ${userId} AND e."userId" = ${userId} AND NOT v."dePrueba" AND v."moneda" = ${moneda}
          AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}
        GROUP BY 1
      `,
    ]);
    return completarDias(rango, [
      ...chats,
      ...ventas.map(({ dia, pedidos, pagados, cobrado }) => ({ dia, pedidos, pagados, cobradoCentavos: Number(cobrado) })),
    ]);
  }

  private async etapas(userId: string, rango: Rango, ahora: Date, zona: FiltroZona | null): Promise<EtapaPublica[]> {
    const filas = await this.prisma.etapaChat.findMany({
      where: {
        userId,
        createdAt: { gte: rango.desde, lt: rango.hasta },
        ...(zona ? { provincia: zona === SIN_ZONA ? null : zona } : {}),
      },
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

  private async productos(userId: string, rango: Rango, moneda: Moneda, zona: FiltroZona | null): Promise<ProductoPerformance[]> {
    const deZona = condicionDeZona(zona);
    // Con zona, una fila desligada (sin conversación) no se sabe de dónde es: queda afuera.
    const interesDeZona = zona ? Prisma.sql`AND i."conversationId" IS NOT NULL ${deZona}` : Prisma.empty;
    const [intereses, pagos, cortes] = await Promise.all([
      // Una fila desligada (sin conversación, pasados los 12 meses) cuenta por su propia fecha.
      this.prisma.$queryRaw<Array<{ productoId: string; tipo: string; chats: number }>>`
        SELECT i."productoId", i."tipo", COUNT(*)::int AS "chats"
        FROM "InteresProducto" i LEFT JOIN "EtapaChat" e ON e."conversationId" = i."conversationId" AND e."userId" = ${userId}
        WHERE i."userId" = ${userId}
          AND CASE WHEN i."conversationId" IS NULL
                   THEN i."createdAt" >= ${rango.desde} AND i."createdAt" < ${rango.hasta}
                   ELSE e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} END
          ${interesDeZona}
        GROUP BY 1, 2
      `,
      // Lo de stock sale de los renglones (por variante); lo a medida, del producto de la solicitud.
      this.prisma.$queryRaw<Array<{ productoId: string; pagaron: number; unidades: number; cobrado: number }>>`
        WITH pagadas AS (
          SELECT v."id", v."tipo", v."conversationId", v."solicitud", v."totalCentavos"
          FROM "Venta" v JOIN "EtapaChat" e ON e."conversationId" = v."conversationId"
          WHERE v."userId" = ${userId} AND e."userId" = ${userId} AND v."estado" = 'pagada' AND NOT v."dePrueba"
            AND v."moneda" = ${moneda} AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}
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
          AND e."createdAt" >= ${rango.desde} AND e."createdAt" < ${rango.hasta} ${deZona}
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

function conTasas(conteos: ConteosConversion): Conversion {
  return {
    ...conteos,
    chatAPedido: tasa(conteos.conPedido, conteos.chats),
    pedidoAPago: tasa(conteos.pagados, conteos.pedidos),
    chatAPago: tasa(conteos.conPago, conteos.chats),
  };
}
