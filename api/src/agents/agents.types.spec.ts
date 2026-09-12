import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GenerateAgentDto } from './agents.types.js';

const base = {
  tipoTitular: 'negocio',
  nombreTitular: 'Estudio La Ñata',
  tipoUso: 'otro',
  tiposEvento: [
    { nombre: 'Sesión de fotos', duracionMin: 90 },
    { nombre: 'Retoque 💇‍♀️ express', duracionMin: 15 },
    { nombre: 'Entrega de álbum / revisión', duracionMin: 30 },
    { nombre: 'Consulta "previa"', duracionMin: 20 },
    { nombre: 'Taller grupal de iluminación para principiantes y curiosos', duracionMin: 120 },
  ],
  horaDesde: '10:00',
  horaHasta: '19:00',
  nombreBot: 'Nina',
};

/** Propiedades con error, recorriendo también los tipos de evento anidados. */
async function errores(payload: Record<string, unknown>): Promise<string[]> {
  const resultado = await validate(plainToInstance(GenerateAgentDto, payload), { whitelist: true });
  return resultado.flatMap((error) =>
    error.children && error.children.length > 0
      ? error.children.flatMap((hijo) => (hijo.children ?? []).map((nieto) => `${error.property}.${nieto.property}`))
      : [error.property],
  );
}

function tipos(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => ({ nombre: `Tipo ${i + 1}`, duracionMin: 30 }));
}

describe('GenerateAgentDto', () => {
  it('acepta el perfil de producción: "otro" con cinco tipos propios', async () => {
    expect(await errores(base)).toEqual([]);
  });

  it('acepta hasta 20 tipos de evento', async () => {
    expect(await errores({ ...base, tiposEvento: tipos(20) })).toEqual([]);
  });

  it('rechaza 21 tipos de evento', async () => {
    expect(await errores({ ...base, tiposEvento: tipos(21) })).toContain('tiposEvento');
  });

  it('rechaza cero tipos de evento', async () => {
    expect(await errores({ ...base, tiposEvento: [] })).toContain('tiposEvento');
  });

  it('rechaza un nombre de tipo de 1 carácter y uno de 61', async () => {
    const cortos = await errores({ ...base, tiposEvento: [{ nombre: 'A', duracionMin: 30 }] });
    const largos = await errores({ ...base, tiposEvento: [{ nombre: 'x'.repeat(61), duracionMin: 30 }] });

    expect(cortos).toContain('tiposEvento.nombre');
    expect(largos).toContain('tiposEvento.nombre');
  });

  it('acepta un nombre de tipo de exactamente 60 caracteres', async () => {
    expect(await errores({ ...base, tiposEvento: [{ nombre: 'x'.repeat(60), duracionMin: 30 }] })).toEqual([]);
  });

  it('rechaza duraciones fuera de 5..480 y no enteras', async () => {
    for (const duracionMin of [4, 481, 22.5]) {
      expect(await errores({ ...base, tiposEvento: [{ nombre: 'Consulta', duracionMin }] })).toContain(
        'tiposEvento.duracionMin',
      );
    }
  });

  it('rechaza horas que no son HH:MM de 24hs', async () => {
    expect(await errores({ ...base, horaDesde: '24:00' })).toContain('horaDesde');
    expect(await errores({ ...base, horaHasta: '9:00' })).toContain('horaHasta');
  });

  it('rechaza un tipo de uso o de titular fuera del catálogo', async () => {
    expect(await errores({ ...base, tipoUso: 'gimnasio' })).toContain('tipoUso');
    expect(await errores({ ...base, tipoTitular: 'empresa' })).toContain('tipoTitular');
  });

  it('rechaza nombres de titular y de asistente vacíos o demasiado largos', async () => {
    expect(await errores({ ...base, nombreTitular: 'A' })).toContain('nombreTitular');
    expect(await errores({ ...base, nombreTitular: 'x'.repeat(81) })).toContain('nombreTitular');
    expect(await errores({ ...base, nombreBot: 'x'.repeat(41) })).toContain('nombreBot');
  });
});
