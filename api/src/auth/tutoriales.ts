import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn } from 'class-validator';

/**
 * Pantallas con recorrido guiado. Cada una se muestra sola la primera vez que
 * la cuenta entra y queda marcada en `User.tutorialesVistos`. Catálogo copiado
 * en web/src/lib/tutorial.tsx (CLAVES) y e2e/tests/fixtures.ts: mantenerlos
 * sincronizados.
 */
export const TUTORIALES = [
  'inicio',
  'calendario',
  'reuniones',
  'chat',
  'productos',
  'costos',
  'ventas',
  'rendimiento',
  'asistente',
  'plan',
] as const;

export type Tutorial = (typeof TUTORIALES)[number];

export class MarcarTutorialesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TUTORIALES.length)
  @IsIn(TUTORIALES, { each: true })
  claves!: Tutorial[];
}

/** Sólo las claves vigentes: una que se sacó del catálogo no le llega a la web. */
export function tutorialesVistos(guardados: readonly string[]): Tutorial[] {
  return TUTORIALES.filter((clave) => guardados.includes(clave));
}
