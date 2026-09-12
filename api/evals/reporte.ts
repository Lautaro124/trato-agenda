import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Resultado = {
  modelo: string;
  caso: string;
  ok: boolean;
  checks: Record<string, boolean>;
  latenciasMs: number[];
  llamadas: number;
  tokensSalida: number;
  costoUsd: number;
  error?: string;
  detalle?: string;
};

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)];
}

/** Sin tildes y en minúsculas, para buscar nombres dentro de un texto generado. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Imprime una tabla por modelo y deja el detalle completo en evals/resultados/. */
export function guardarReporte(nombre: string, resultados: Resultado[]): void {
  if (resultados.length === 0) return;

  const porModelo = new Map<string, Resultado[]>();
  for (const resultado of resultados) {
    porModelo.set(resultado.modelo, [...(porModelo.get(resultado.modelo) ?? []), resultado]);
  }

  const filas = [...porModelo.entries()].map(([modelo, casos]) => {
    const checks = casos.flatMap((caso) => Object.values(caso.checks));
    const latencias = casos.flatMap((caso) => caso.latenciasMs);
    return {
      modelo,
      casosOk: `${casos.filter((caso) => caso.ok).length}/${casos.length}`,
      checksOk: `${Math.round((100 * checks.filter(Boolean).length) / Math.max(1, checks.length))}%`,
      p50Ms: percentil(latencias, 50),
      p90Ms: percentil(latencias, 90),
      llamadas: casos.reduce((total, caso) => total + caso.llamadas, 0),
      tokensSalida: casos.reduce((total, caso) => total + caso.tokensSalida, 0),
      costoUsd: Number(casos.reduce((total, caso) => total + caso.costoUsd, 0).toFixed(5)),
    };
  });

  console.log(`\n=== Eval: ${nombre} ===`);
  console.table(filas);

  const directorio = join(dirname(fileURLToPath(import.meta.url)), 'resultados');
  mkdirSync(directorio, { recursive: true });
  const archivo = join(directorio, `${nombre}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(archivo, JSON.stringify({ resumen: filas, resultados }, null, 2));
  console.log(`Detalle: ${archivo}`);
}
