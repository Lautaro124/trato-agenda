import type { Prisma } from '../generated/prisma/client.js';

type ConsultaCruda = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Unidades retenidas por pedidos pendientes y sin vencer, por producto. Es la
 * única cuenta de "reservado" del sistema: la usan la creación de pedidos
 * (dentro de su transacción) y la búsqueda del asistente (para decir si hay).
 */
export async function reservadasPorProducto(
  db: ConsultaCruda,
  productoIds: string[],
  ahora: Date = new Date(),
): Promise<Map<string, number>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.$queryRaw<Array<{ productoId: string; reservadas: number }>>`
    SELECT i."productoId", SUM(i."cantidad")::int AS "reservadas"
    FROM "ItemVenta" i JOIN "Venta" v ON v."id" = i."ventaId"
    WHERE v."estado" = 'pendiente_pago' AND v."reservaVenceAt" > ${ahora}
      AND i."productoId" = ANY(${productoIds})
    GROUP BY i."productoId"
  `;
  return new Map(filas.map((fila) => [fila.productoId, fila.reservadas]));
}
