/**
 * Eval de la generación de agentes contra OpenRouter real: por cada modelo y
 * cada perfil de evals/perfiles.ts corre el AgentsService de verdad (con la
 * base en memoria) y mide si sale de primera, cuánto tarda, cuánto cuesta y
 * si el prompt generado nombra lo que tiene que nombrar.
 *
 *   docker compose exec api npm run eval -- generacion
 *   EVAL_MODELOS=deepseek/deepseek-v4-flash:nitro npm run eval -- generacion
 */
import 'dotenv/config';
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentsService } from '../src/agents/agents.service.js';
import { OpenRouterClient, type ChatOptions, type UsoTokens } from '../src/agents/openrouter.client.js';
import { OPENROUTER_BASE_URL_POR_DEFECTO, type Env } from '../src/config/env.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { HAY_CLAVE, modelosDelEval } from './modelos.js';
import { PERFILES } from './perfiles.js';
import { guardarReporte, normalizar, type Resultado } from './reporte.js';

/** El prompt pedido es de 200 palabras: bastante más que esto es que no hizo caso. */
const LARGO_MAXIMO_PROMPT = 1600;

function configPara(modelo: string): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO,
    OPENROUTER_MODEL: modelo,
    OPENROUTER_MODEL_AGENTES: modelo,
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

describe.skipIf(!HAY_CLAVE)('eval: generación de agentes', () => {
  const resultados: Resultado[] = [];
  afterAll(() => guardarReporte('generacion', resultados));

  for (const modelo of modelosDelEval()) {
    for (const perfil of PERFILES) {
      it(`${modelo} · ${perfil.id}`, async () => {
        const config = configPara(modelo);
        const cliente = new OpenRouterClient(config);
        const usos: UsoTokens[] = [];
        let llamadas = 0;
        const chatOriginal = cliente.chat.bind(cliente);
        cliente.chat = async (opciones: ChatOptions) => {
          llamadas++;
          const respuesta = await chatOriginal(opciones);
          if (respuesta.usage) usos.push(respuesta.usage);
          return respuesta;
        };

        const prisma = {
          agent: { upsert: async ({ create }: { create: Record<string, unknown> }) => ({ id: 'eval', ...create }) },
        } as unknown as PrismaService;
        const servicio = new AgentsService(prisma, cliente, config);

        const inicio = Date.now();
        const resultado: Resultado = {
          modelo,
          caso: perfil.id,
          ok: false,
          checks: {},
          latenciasMs: [],
          llamadas: 0,
          tokensSalida: 0,
          costoUsd: 0,
        };

        try {
          const agente = await servicio.generate('eval', perfil.dto);
          const prompt = normalizar(agente.systemPrompt);
          const tiposNombrados = perfil.dto.tiposEvento.filter((tipo) => prompt.includes(normalizar(tipo.nombre)));

          resultado.checks = {
            deUna: llamadas === 1,
            accionesBasicas: ['consultar_disponibilidad', 'crear_turno'].every((accion) =>
              agente.allowedActions.includes(accion),
            ),
            nombraBot: prompt.includes(normalizar(perfil.dto.nombreBot)),
            nombraTitular: prompt.includes(normalizar(perfil.dto.nombreTitular)),
            // Con 20 tipos se tolera que resuma: alcanza con la mayoría.
            nombraTipos: tiposNombrados.length >= Math.ceil(perfil.dto.tiposEvento.length * 0.8),
            nombraFranja: prompt.includes(perfil.dto.horaDesde) && prompt.includes(perfil.dto.horaHasta),
            largoRazonable: agente.systemPrompt.length <= LARGO_MAXIMO_PROMPT,
            menos20s: Date.now() - inicio < 20_000,
          };
          resultado.detalle = agente.systemPrompt;
        } catch (error) {
          resultado.error = (error as Error).message;
          resultado.checks = { genera: false };
        } finally {
          resultado.latenciasMs = [Date.now() - inicio];
          resultado.llamadas = llamadas;
          resultado.tokensSalida = usos.reduce((total, uso) => total + (uso.completion_tokens ?? 0), 0);
          resultado.costoUsd = usos.reduce((total, uso) => total + (uso.cost ?? 0), 0);
          resultado.ok = Object.values(resultado.checks).every(Boolean);
          resultados.push(resultado);
        }

        // Soft: un modelo flojo no corta la corrida, queda marcado en el reporte.
        expect.soft(resultado.error, 'la generación no debería fallar').toBeUndefined();
        for (const [check, paso] of Object.entries(resultado.checks)) {
          expect.soft(paso, check).toBe(true);
        }
      });
    }
  }
});
