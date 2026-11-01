import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MarcarTutorialesDto, TUTORIALES, tutorialesVistos } from './tutoriales.js';

async function errores(cuerpo: unknown): Promise<number> {
  return (await validate(plainToInstance(MarcarTutorialesDto, cuerpo), { whitelist: true })).length;
}

describe('MarcarTutorialesDto', () => {
  it('acepta claves del catálogo, una o todas', async () => {
    expect(await errores({ claves: ['inicio'] })).toBe(0);
    expect(await errores({ claves: [...TUTORIALES] })).toBe(0);
  });

  it('rechaza claves inventadas, listas vacías y listas de más', async () => {
    expect(await errores({ claves: ['inventada'] })).toBe(1);
    expect(await errores({ claves: [] })).toBe(1);
    expect(await errores({ claves: [...TUTORIALES, 'inicio'] })).toBe(1);
    expect(await errores({ claves: 'inicio' })).toBe(1);
  });
});

describe('tutorialesVistos', () => {
  it('devuelve sólo las claves vigentes, en el orden del catálogo', () => {
    expect(tutorialesVistos(['plan', 'vieja', 'inicio'])).toEqual(['inicio', 'plan']);
  });
});
