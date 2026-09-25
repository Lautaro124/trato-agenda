import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCIONES_IDS, TIPOS_TITULAR, TIPOS_USO, TIPOS_USO_RETIRADOS } from '../agent-catalog.js';

/**
 * `agent-catalog.ts` documenta ser la fuente del catálogo, pero el wizard web
 * (`web/src/app/contanos/useOnboarding.ts`) mantiene su propia copia manual —
 * no hay paquete compartido entre `api/` y `web/`. Hoy los ids coinciden, pero
 * nada impide que diverjan en un cambio futuro a uno solo de los dos lados:
 * este test existe para que ESE día falle acá, en vez de fallar en producción
 * como un tipoUso que el backend rechaza silenciosamente.
 */
const RUTA_WIZARD = fileURLToPath(new URL('../../../../web/src/app/contanos/useOnboarding.ts', import.meta.url));

function extraerIds(bloque: string): string[] {
  return [...bloque.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
}

describe('catálogo de tipos de uso: api/ vs web/ (defecto A-021)', () => {
  it('los ids de TIPOS_USO del wizard web coinciden con agent-catalog.ts', () => {
    const texto = readFileSync(RUTA_WIZARD, 'utf8');
    // El tipo declarado (`Array<{ id: TipoUsoId; ... }>`) trae sus propios ";"
    // antes del "= [" real, así que se corta en el cierre del array literal
    // ("\n];"), no en el primer ";".
    const bloque = texto.match(/export const TIPOS_USO[\s\S]*?=\s*\[[\s\S]*?\n\];/)?.[0];
    expect(bloque, 'no se encontró TIPOS_USO en useOnboarding.ts — revisar la ruta o el nombre').toBeDefined();

    const idsWeb = new Set(extraerIds(bloque!));
    // Compara como conjuntos: el orden no importa, la existencia de cada id sí.
    // Los retirados del wizard siguen en la API a propósito (agentes ya guardados).
    expect(new Set([...idsWeb, ...TIPOS_USO_RETIRADOS])).toEqual(new Set(TIPOS_USO));
    for (const id of TIPOS_USO_RETIRADOS) expect(idsWeb.has(id)).toBe(false);
  });

  it('TIPOS_TITULAR y ACCIONES_IDS no están duplicados en ningún otro archivo del backend (sanity del propio catálogo)', () => {
    expect(TIPOS_TITULAR).toEqual(['persona', 'negocio']);
    expect(ACCIONES_IDS.length).toBeGreaterThan(0);
  });
});
