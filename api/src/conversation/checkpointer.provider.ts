/**
 * Checkpointer del grafo: el estado de cada conversación vive en Postgres, en
 * las tablas que crea LangGraph (checkpoints, checkpoint_writes,
 * checkpoint_blobs, checkpoint_migrations). Están fuera de las migraciones de
 * Prisma a propósito — las crea `setup()` al arrancar la API.
 *
 * Como están fuera, un `prisma migrate reset` con la API levantada las borra y
 * nadie las vuelve a crear hasta el próximo boot: el grafo queda muerto y cada
 * mensaje falla con `relation "public.checkpoints" does not exist`. Por eso el
 * saver se auto-repara: ante ese error corre `setup()` de nuevo (es idempotente
 * y se recupera solo del caso "tablas dropeadas") y reintenta la operación.
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { Env } from '../config/env.js';

/** Pool propio, aparte del que abre el adapter de Prisma: alcanza con pocas conexiones. */
const MAX_CONEXIONES = 5;

/** `undefined_table` de Postgres: la tabla que pide la consulta no existe. */
const CODIGO_TABLA_INEXISTENTE = '42P01';

/** true si el error viene de que faltan las tablas del checkpointer. */
export function esTablaFaltante(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === CODIGO_TABLA_INEXISTENTE) return true;
  // Fallback por si el driver envuelve el error y se pierde el código.
  return (
    typeof message === 'string' && message.includes('does not exist') && message.includes('checkpoint')
  );
}

/**
 * Corre operaciones contra el checkpointer y, si fallan porque faltan sus
 * tablas, las recrea y reintenta una sola vez. Las reparaciones concurrentes
 * comparten la misma promesa: varios mensajes en paralelo no disparan N
 * migraciones a la vez.
 */
export class ReparadorDeTablas {
  private enCurso?: Promise<void>;

  constructor(
    private readonly recrear: () => Promise<void>,
    private readonly alReparar: () => void = () => {},
  ) {}

  async ejecutar<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      if (!esTablaFaltante(error)) throw error;
      await this.reparar();
      return operacion();
    }
  }

  /**
   * Igual que `ejecutar`, para los métodos que devuelven un generador. Sólo
   * reintenta si el error llegó antes del primer elemento: si ya emitió algo,
   * repetir el generador duplicaría filas.
   */
  async *iterar<T>(crear: () => AsyncGenerator<T>): AsyncGenerator<T> {
    let emitidos = 0;
    try {
      for await (const elemento of crear()) {
        emitidos += 1;
        yield elemento;
      }
      return;
    } catch (error) {
      if (emitidos > 0 || !esTablaFaltante(error)) throw error;
      await this.reparar();
    }
    yield* crear();
  }

  private async reparar(): Promise<void> {
    const reparacion = (this.enCurso ??= this.recrearYLiberar());
    await reparacion;
  }

  private async recrearYLiberar(): Promise<void> {
    this.alReparar();
    try {
      await this.recrear();
    } finally {
      this.enCurso = undefined;
    }
  }
}

/** `PostgresSaver` que recrea sus tablas si desaparecieron bajo sus pies. */
export class SaverAutoReparable extends PostgresSaver {
  private readonly reparador: ReparadorDeTablas;

  constructor(pool: pg.Pool, alReparar?: () => void) {
    super(pool);
    this.reparador = new ReparadorDeTablas(() => this.setup(), alReparar);
  }

  getTuple(
    ...args: Parameters<PostgresSaver['getTuple']>
  ): ReturnType<PostgresSaver['getTuple']> {
    return this.reparador.ejecutar(() => super.getTuple(...args));
  }

  async *list(...args: Parameters<PostgresSaver['list']>): ReturnType<PostgresSaver['list']> {
    yield* this.reparador.iterar(() => super.list(...args));
  }

  put(...args: Parameters<PostgresSaver['put']>): ReturnType<PostgresSaver['put']> {
    return this.reparador.ejecutar(() => super.put(...args));
  }

  putWrites(
    ...args: Parameters<PostgresSaver['putWrites']>
  ): ReturnType<PostgresSaver['putWrites']> {
    return this.reparador.ejecutar(() => super.putWrites(...args));
  }

  /** Lo usa la baja de cuenta: borrar un thread que no existe no es un error. */
  deleteThread(
    ...args: Parameters<PostgresSaver['deleteThread']>
  ): ReturnType<PostgresSaver['deleteThread']> {
    return this.reparador.ejecutar(() => super.deleteThread(...args));
  }
}

@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckpointerService.name);
  readonly saver: PostgresSaver;

  constructor(config: ConfigService<Env, true>) {
    const pool = new pg.Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: MAX_CONEXIONES,
    });
    this.saver = new SaverAutoReparable(pool, () => {
      this.logger.warn('Faltaban las tablas del checkpointer de LangGraph: recreándolas.');
    });
  }

  async onModuleInit(): Promise<void> {
    await this.saver.setup();
    this.logger.log('Tablas del checkpointer de LangGraph listas.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.saver.end();
  }
}
