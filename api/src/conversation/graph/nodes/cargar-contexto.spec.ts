import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../generated/prisma/client.js';
import { reglasDeAgenda, reglasDeAlcance } from './cargar-contexto.node.js';

const AGENT = {
  nombreTitular: 'Tienda Centro',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [{ nombre: 'Probador', duracionMin: 20 }],
} as unknown as Agent;

describe('reglasDeAgenda', () => {
  it('arma las reglas duras desde la fila Agent', () => {
    const reglas = reglasDeAgenda(AGENT);

    expect(reglas).toContain('Tienda Centro');
    expect(reglas).toContain('Tati');
    expect(reglas).toContain('de 09:00 a 18:00');
    expect(reglas).toContain('Probador (20 min)');
  });
});

describe('reglasDeAlcance', () => {
  it('deja el alcance en la agenda del titular y lo que sí puede contar del negocio', () => {
    const alcance = reglasDeAlcance(AGENT, false);

    expect(alcance).toContain('existís sólo para la agenda de Tienda Centro');
    expect(alcance).toContain('franja horaria de atención');
    expect(alcance).toContain('tipos de turno');
  });

  it('prohíbe responder otros temas, también cuando vienen mezclados con el turno', () => {
    const alcance = reglasDeAlcance(AGENT, false);

    expect(alcance).toContain('Cualquier otro tema queda afuera');
    expect(alcance).toMatch(/mezclado con algo del turno/);
    expect(alcance).toContain('Saludos, gracias y despedidas');
  });

  it('deriva al titular los datos del negocio que no tiene cargados', () => {
    const alcance = reglasDeAlcance(AGENT, false);

    expect(alcance).toContain('nunca los inventes');
    expect(alcance).toContain('consulte directamente con Tienda Centro');
  });

  it('con el dueño no lo deriva a sí mismo', () => {
    const alcance = reglasDeAlcance(AGENT, true);

    expect(alcance).toContain('vos sólo manejás la agenda');
    expect(alcance).not.toContain('consulte directamente con');
  });

  it('cae en "este negocio" si el titular no tiene nombre cargado', () => {
    const alcance = reglasDeAlcance({ ...AGENT, nombreTitular: '' } as Agent, false);

    expect(alcance).toContain('existís sólo para la agenda de este negocio');
  });
});
