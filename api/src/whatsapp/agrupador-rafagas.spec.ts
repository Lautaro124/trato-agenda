import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VueltaCancelada, type Cancelacion } from '../conversation/cancelacion.js';
import { AgrupadorDeRafagas } from './agrupador-rafagas.js';
import {
  ESPERA_RAFAGA_MS,
  MAX_CANCELACIONES_POR_RAFAGA,
  MAX_CARACTERES_RAFAGA,
  MAX_MENSAJES_RAFAGA,
} from './ritmo-humano.js';

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

  describe('si llega otro mensaje mientras se arma la respuesta', () => {
    /** Un procesar que, como el grafo, termina con VueltaCancelada si se descarta antes de comprometerse. */
    function cancelable(comprometerAlEmpezar = false) {
      return vi.fn((_clave: string, _items: string[], cancelacion: Cancelacion) => {
        if (comprometerAlEmpezar) cancelacion.comprometer();
        return new Promise<void>((resolve, reject) => {
          cancelacion.signal.addEventListener('abort', () => reject(new VueltaCancelada()));
          setTimeout(resolve, 10_000);
        });
      });
    }

    it('la descarta y la rehace con todo junto, después del silencio', async () => {
      const procesar = cancelable();
      const { agrupador } = crear(procesar as never);

      agrupador.agregar('u\nc', 'hola');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      expect(procesar).toHaveBeenCalledOnce();

      agrupador.agregar('u\nc', 'y otra cosa');
      await vi.advanceTimersByTimeAsync(0);
      expect(procesar.mock.calls[0][2].cancelada).toBe(true);
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS - 1);
      expect(procesar).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      expect(procesar).toHaveBeenCalledTimes(2);
      expect(procesar.mock.calls[1][1]).toEqual(['hola', 'y otra cosa']);
    });

    it('pasado el tope de descartes, la respuesta sale igual', async () => {
      const procesar = cancelable();
      const { agrupador } = crear(procesar as never);

      agrupador.agregar('u\nc', 'm0');
      for (let vez = 1; vez <= MAX_CANCELACIONES_POR_RAFAGA + 1; vez++) {
        await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
        agrupador.agregar('u\nc', `m${vez}`);
      }
      await vi.runAllTimersAsync();

      // La última corrida no se canceló: el mensaje que llegó durante ella sale después, solo.
      const llamadas = procesar.mock.calls;
      expect(llamadas[MAX_CANCELACIONES_POR_RAFAGA][2].cancelada).toBe(false);
      expect(llamadas.at(-1)![1]).toEqual([`m${MAX_CANCELACIONES_POR_RAFAGA + 1}`]);
    });

    it('una respuesta comprometida no se descarta: lo nuevo espera a que termine', async () => {
      const procesar = cancelable(true);
      const { agrupador } = crear(procesar as never);

      agrupador.agregar('u\nc', 'hola');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      agrupador.agregar('u\nc', 'otra');
      await vi.runAllTimersAsync();

      expect(procesar.mock.calls[0][2].cancelada).toBe(false);
      expect(procesar.mock.calls.map(([, items]) => items)).toEqual([['hola'], ['otra']]);
    });

    it('al descartar al dueño, una respuesta cancelada no vuelve a la cola', async () => {
      const procesar = cancelable();
      const { agrupador } = crear(procesar as never);

      agrupador.agregar('u\nc', 'hola');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      agrupador.descartar('u\n');
      await vi.runAllTimersAsync();

      expect(procesar).toHaveBeenCalledOnce();
      expect(procesar.mock.calls[0][2].cancelada).toBe(true);
    });
  });
});
