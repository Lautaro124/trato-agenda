import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgrupadorDeRafagas } from './agrupador-rafagas.js';
import { ESPERA_RAFAGA_MS, MAX_CARACTERES_RAFAGA, MAX_MENSAJES_RAFAGA } from './ritmo-humano.js';

describe('AgrupadorDeRafagas', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function crear(procesar = vi.fn().mockResolvedValue(undefined)) {
    const agrupador = new AgrupadorDeRafagas<string>(procesar, vi.fn(), (texto) => texto.length);
    return { agrupador, procesar };
  }

  it('con la ráfaga llena contesta ya, sin esperar el silencio', async () => {
    const { agrupador, procesar } = crear();

    for (let i = 0; i < MAX_MENSAJES_RAFAGA; i++) agrupador.agregar('u\nc', `m${i}`);
    await vi.advanceTimersByTimeAsync(0);

    expect(procesar).toHaveBeenCalledOnce();
    expect(procesar.mock.calls[0][1]).toHaveLength(MAX_MENSAJES_RAFAGA);
  });

  it('el tope de caracteres también la cierra', async () => {
    const { agrupador, procesar } = crear();

    agrupador.agregar('u\nc', 'x'.repeat(MAX_CARACTERES_RAFAGA));
    await vi.advanceTimersByTimeAsync(0);

    expect(procesar).toHaveBeenCalledOnce();
  });

  it('mientras contesta, lo que pasa del tope se descarta', async () => {
    let terminar: () => void = () => undefined;
    const procesar = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (terminar = resolve)))
      .mockResolvedValue(undefined);
    const { agrupador } = crear(procesar);

    agrupador.agregar('u\nc', 'primero');
    await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
    for (let i = 0; i < MAX_MENSAJES_RAFAGA * 5; i++) agrupador.agregar('u\nc', `spam${i}`);
    terminar();
    await vi.runAllTimersAsync();

    expect(procesar).toHaveBeenCalledTimes(2);
    expect(procesar.mock.calls[1][1]).toHaveLength(MAX_MENSAJES_RAFAGA);
  });

  it('descartar olvida lo pendiente de ese dueño y no toca a los demás', async () => {
    const { agrupador, procesar } = crear();

    agrupador.agregar('u1\nc', 'hola');
    agrupador.agregar('u2\nc', 'hola');
    agrupador.descartar('u1\n');
    await vi.runAllTimersAsync();

    expect(procesar).toHaveBeenCalledOnce();
    expect(procesar.mock.calls[0][0]).toBe('u2\nc');
  });
});
