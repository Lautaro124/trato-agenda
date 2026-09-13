import { API_URL } from '../entorno';
import { agenteActual, expect, sufijo, test } from './fixtures';

/**
 * RL2-001: salida de generación cortada a mitad del JSON (`finish_reason:
 * "length"`, ver `[corte-N]` en el stub). La API debe tratarlo como una
 * respuesta inválida — mismo camino que `[json-roto]` — y nunca persistir una
 * config a medias.
 */
test.describe('salida truncada (dimensión RL2: recursos limitados)', () => {
  test('un JSON cortado a la mitad no deja un Agent con systemPrompt truncado', async ({ context, usuarioDev }) => {
    void usuarioDev;
    const nombreTitular = `Corte E2E ${sufijo()} [corte-20]`;

    const respuesta = await context.request.post(`${API_URL}/agents/generate`, {
      data: {
        tipoTitular: 'negocio',
        nombreTitular,
        tipoUso: 'comercio',
        tiposEvento: [{ nombre: 'Turno', duracionMin: 30 }],
        horaDesde: '09:00',
        horaHasta: '18:00',
        nombreBot: 'Bot',
      },
      timeout: 90_000,
    });

    // El stub sólo trunca en el primer intento; el reintento de AgentsService
    // repite la MISMA marca en el titular, así que corta de nuevo -> 502.
    expect(respuesta.status()).toBe(502);

    const agente = await agenteActual(context.request);
    expect(agente).toBeNull();
  });
});
