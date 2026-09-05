import { describe, expect, it, vi } from 'vitest';
import { ReparadorDeTablas, esTablaFaltante } from './checkpointer.provider.js';

/** Error tal cual lo tira `pg` cuando la tabla no existe. */
function errorDeTablaFaltante(): Error & { code: string } {
  return Object.assign(new Error('relation "public.checkpoints" does not exist'), {
    code: '42P01',
  });
}

describe('esTablaFaltante', () => {
  it('reconoce el 42P01 de Postgres', () => {
    expect(esTablaFaltante(errorDeTablaFaltante())).toBe(true);
  });

  it('reconoce el mensaje aunque se haya perdido el código', () => {
    expect(esTablaFaltante(new Error('relation "public.checkpoint_writes" does not exist'))).toBe(true);
  });

  it('no confunde otros errores de la base', () => {
    const otro = Object.assign(new Error('duplicate key value'), { code: '23505' });
    expect(esTablaFaltante(otro)).toBe(false);
    expect(esTablaFaltante(new Error('timeout'))).toBe(false);
    expect(esTablaFaltante(null)).toBe(false);
  });
});

describe('ReparadorDeTablas.ejecutar', () => {
  it('recrea las tablas y reintenta una sola vez', async () => {
    const recrear = vi.fn().mockResolvedValue(undefined);
    const alReparar = vi.fn();
    const operacion = vi.fn().mockRejectedValueOnce(errorDeTablaFaltante()).mockResolvedValue('ok');

    const resultado = await new ReparadorDeTablas(recrear, alReparar).ejecutar(operacion);

    expect(resultado).toBe('ok');
    expect(recrear).toHaveBeenCalledTimes(1);
    expect(alReparar).toHaveBeenCalledTimes(1);
    expect(operacion).toHaveBeenCalledTimes(2);
  });

  it('no reintenta ni repara ante otros errores', async () => {
    const recrear = vi.fn().mockResolvedValue(undefined);
    const operacion = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(new ReparadorDeTablas(recrear).ejecutar(operacion)).rejects.toThrow('timeout');
    expect(recrear).not.toHaveBeenCalled();
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si el reintento vuelve a fallar', async () => {
    const operacion = vi.fn().mockRejectedValue(errorDeTablaFaltante());
    const reparador = new ReparadorDeTablas(vi.fn().mockResolvedValue(undefined));

    await expect(reparador.ejecutar(operacion)).rejects.toThrow('does not exist');
    expect(operacion).toHaveBeenCalledTimes(2);
  });

  it('dos operaciones en paralelo comparten una única reparación', async () => {
    let liberar: () => void = () => {};
    const recrear = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          liberar = resolve;
        }),
    );
    const reparador = new ReparadorDeTablas(recrear);
    let llamadas = 0;
    const operacion = () => {
      llamadas += 1;
      return llamadas <= 2 ? Promise.reject(errorDeTablaFaltante()) : Promise.resolve('ok');
    };

    const ambas = Promise.all([reparador.ejecutar(operacion), reparador.ejecutar(operacion)]);
    await Promise.resolve();
    liberar();

    expect(await ambas).toEqual(['ok', 'ok']);
    expect(recrear).toHaveBeenCalledTimes(1);
  });
});

describe('ReparadorDeTablas.iterar', () => {
  async function* generadorOk(): AsyncGenerator<string> {
    yield 'a';
    yield 'b';
  }

  async function* generadorQueFalla(): AsyncGenerator<string> {
    await Promise.reject(errorDeTablaFaltante());
    yield 'inalcanzable';
  }

  it('repara y rehace el generador si falla antes del primer elemento', async () => {
    const recrear = vi.fn().mockResolvedValue(undefined);
    let primeraVez = true;
    const crear = (): AsyncGenerator<string> => {
      if (primeraVez) {
        primeraVez = false;
        return generadorQueFalla();
      }
      return generadorOk();
    };

    const emitidos: string[] = [];
    for await (const valor of new ReparadorDeTablas(recrear).iterar(crear)) emitidos.push(valor);

    expect(emitidos).toEqual(['a', 'b']);
    expect(recrear).toHaveBeenCalledTimes(1);
  });

  it('no rehace el generador si ya había emitido algo', async () => {
    const recrear = vi.fn().mockResolvedValue(undefined);
    async function* generadorQueFallaTarde(): AsyncGenerator<string> {
      yield 'a';
      await Promise.reject(errorDeTablaFaltante());
    }
    const crear = vi.fn(generadorQueFallaTarde);

    const reparador = new ReparadorDeTablas(recrear);
    const consumir = async () => {
      for await (const _ of reparador.iterar(crear)) void _;
    };

    await expect(consumir()).rejects.toThrow('does not exist');
    expect(recrear).not.toHaveBeenCalled();
    expect(crear).toHaveBeenCalledTimes(1);
  });
});
