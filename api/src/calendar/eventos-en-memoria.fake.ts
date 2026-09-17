import type { PrismaService } from '../prisma/prisma.service.js';

type FilaEvento = { id: string; userId: string; resumen: string; inicio: Date; fin: Date };
type Rango = { lt?: Date; gt?: Date; lte?: Date };
type Donde = { id?: string; userId?: string; inicio?: Rango; fin?: Rango };

function cumple(fila: FilaEvento, donde: Donde): boolean {
  if (donde.id !== undefined && fila.id !== donde.id) return false;
  if (donde.userId !== undefined && fila.userId !== donde.userId) return false;
  for (const campo of ['inicio', 'fin'] as const) {
    const rango = donde[campo];
    if (rango?.lt && !(fila[campo] < rango.lt)) return false;
    if (rango?.gt && !(fila[campo] > rango.gt)) return false;
    if (rango?.lte && !(fila[campo] <= rango.lte)) return false;
  }
  return true;
}

/**
 * Doble de `prisma.evento` para los specs: sólo lo que usa CalendarioLocal
 * (filtros por id, userId y rangos lt/gt/lte, orden por inicio).
 */
export function prismaConEventosEnMemoria(): { prisma: PrismaService; filas: FilaEvento[] } {
  const filas: FilaEvento[] = [];
  let siguiente = 1;
  const copia = (fila: FilaEvento): FilaEvento => ({ ...fila, inicio: new Date(fila.inicio), fin: new Date(fila.fin) });

  const evento = {
    findFirst: async ({ where }: { where: Donde }) => {
      const fila = filas.find((f) => cumple(f, where));
      return fila ? copia(fila) : null;
    },
    findMany: async ({ where }: { where: Donde }) =>
      filas
        .filter((f) => cumple(f, where))
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
        .map(copia),
    create: async ({ data }: { data: Omit<FilaEvento, 'id'> }) => {
      const fila = { id: `evento-${siguiente++}`, ...data };
      filas.push(copia(fila));
      return copia(fila);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FilaEvento> }) => {
      const fila = filas.find((f) => f.id === where.id);
      if (!fila) throw new Error('P2025');
      Object.assign(fila, data);
      return copia(fila);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const indice = filas.findIndex((f) => f.id === where.id);
      if (indice < 0) throw new Error('P2025');
      return filas.splice(indice, 1)[0];
    },
    deleteMany: async ({ where }: { where: Donde }) => {
      const antes = filas.length;
      for (let i = filas.length - 1; i >= 0; i--) if (cumple(filas[i], where)) filas.splice(i, 1);
      return { count: antes - filas.length };
    },
  };

  return { prisma: { evento } as unknown as PrismaService, filas };
}
