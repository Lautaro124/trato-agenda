import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VueltaCancelada, type Cancelacion } from '../conversation/cancelacion.js';
import { AgrupadorDeRafagas } from './agrupador-rafagas.js';
import {
  ESCRIBIENDO_VENCE_MS,
  ESPERA_RAFAGA_MS,
  MAX_CANCELACIONES_POR_RAFAGA,
  MAX_CARACTERES_RAFAGA,
  MAX_MENSAJES_RAFAGA,
  MAXIMO_RAFAGA_ESCRIBIENDO_MS,
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

  describe('mientras el cliente escribe', () => {
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

    it('no contesta mientras escribe y, cuando para, espera el silencio de siempre', async () => {
      const { agrupador, procesar } = crear();

      agrupador.agregar('u\nc', 'hola');
      agrupador.escribiendo('u\nc', true);
      await vi.advanceTimersByTimeAsync(ESCRIBIENDO_VENCE_MS - 1);
      expect(procesar).not.toHaveBeenCalled();

      agrupador.escribiendo('u\nc', false);
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      expect(procesar).toHaveBeenCalledOnce();
    });

    it('un "escribiendo" que nunca se apaga vence solo', async () => {
      const { agrupador, procesar } = crear();

      agrupador.agregar('u\nc', 'hola');
      agrupador.escribiendo('u\nc', true);
      await vi.advanceTimersByTimeAsync(ESCRIBIENDO_VENCE_MS);

      expect(procesar).toHaveBeenCalledOnce();
    });

    it('aunque renueve el "escribiendo" sin parar, se contesta al llegar al tope', async () => {
      const { agrupador, procesar } = crear();

      agrupador.agregar('u\nc', 'hola');
      for (let ms = 0; ms < MAXIMO_RAFAGA_ESCRIBIENDO_MS; ms += 5_000) {
        agrupador.escribiendo('u\nc', true);
        await vi.advanceTimersByTimeAsync(5_000);
      }

      expect(procesar).toHaveBeenCalledOnce();
    });

    it('si vuelve a escribir mientras se arma la respuesta, la descarta y la rehace con todo junto', async () => {
      const procesar = cancelable();
      const { agrupador } = crear(procesar as never);

      agrupador.agregar('u\nc', 'hola');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      expect(procesar).toHaveBeenCalledOnce();

      agrupador.escribiendo('u\nc', true);
      await vi.advanceTimersByTimeAsync(0);
      expect(procesar.mock.calls[0][2].cancelada).toBe(true);
      agrupador.agregar('u\nc', 'y otra cosa');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);

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

    it('un "escribiendo" sin nada que contestar no se guarda', () => {
      const { agrupador } = crear();
      agrupador.escribiendo('u\nc', true);
      expect(agrupador.estaEscribiendo('u\nc')).toBe(false);
    });

    it('esperarSilencio vuelve cuando deja de escribir, o al máximo', async () => {
      // Una respuesta ya comprometida saliendo: ahí es cuando se espera el silencio.
      const { agrupador } = crear(cancelable(true) as never);
      agrupador.agregar('u\nc', 'hola');
      await vi.advanceTimersByTimeAsync(ESPERA_RAFAGA_MS);
      const listo = vi.fn();

      agrupador.escribiendo('u\nc', true);
      void agrupador.esperarSilencio('u\nc', 60_000).then(listo);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(listo).not.toHaveBeenCalled();
      agrupador.escribiendo('u\nc', false);
      await vi.advanceTimersByTimeAsync(0);
      expect(listo).toHaveBeenCalledOnce();

      const conTope = vi.fn();
      agrupador.escribiendo('u\nc', true);
      void agrupador.esperarSilencio('u\nc', 2_000).then(conTope);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(conTope).toHaveBeenCalledOnce();
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
