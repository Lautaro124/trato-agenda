/**
 * Checkpointer del grafo: el estado de cada conversación vive en Postgres, en
 * las tablas que crea LangGraph (checkpoints, checkpoint_writes,
 * checkpoint_blobs, checkpoint_migrations). Están fuera de las migraciones de
 * Prisma a propósito — las crea `setup()` al arrancar la API.
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { Env } from '../config/env.js';

/** Pool propio, aparte del que abre el adapter de Prisma: alcanza con pocas conexiones. */
const MAX_CONEXIONES = 5;

@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckpointerService.name);
  readonly saver: PostgresSaver;

  constructor(config: ConfigService<Env, true>) {
    const pool = new pg.Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: MAX_CONEXIONES,
    });
    this.saver = new PostgresSaver(pool);
  }

  async onModuleInit(): Promise<void> {
    await this.saver.setup();
    this.logger.log('Tablas del checkpointer de LangGraph listas.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.saver.end();
  }
}
