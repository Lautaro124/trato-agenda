import type { Prisma } from '../generated/prisma/client.js';

type ConsultaCruda = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Unidades retenidas por pedidos pendientes y sin vencer, por variante. Es la
 * única cuenta de "reservado" del sistema: la usan la creación de pedidos
 * (dentro de su transacción) y la búsqueda del asistente (para decir si hay).
 */
export async function reservadasPorVariante(
  db: ConsultaCruda,
  varianteIds: string[],
  ahora: Date = new Date(),
): Promise<Map<string, number>> {
  if (varianteIds.length === 0) return new Map();
  const filas = await db.$queryRaw<Array<{ varianteId: string; reservadas: number }>>`
    SELECT i."varianteId", SUM(i."cantidad")::int AS "reservadas"
    FROM "ItemVenta" i JOIN "Venta" v ON v."id" = i."ventaId"
    WHERE v."estado" = 'pendiente_pago' AND v."reservaVenceAt" > ${ahora}
      AND i."varianteId" = ANY(${varianteIds})
    GROUP BY i."varianteId"
  `;
  return new Map(filas.map((fila) => [fila.varianteId, fila.reservadas]));
}
