/**
 * Eval del runtime conversacional con textos difíciles, contra OpenRouter
 * real: el grafo de LangGraph completo (mismas reglas, mismo prompt, mismo
 * `reasoning` que producción), con la base en memoria y el calendario falso
 * de desarrollo. Los checks miran el estado final del calendario, no el texto:
 * así se puede comparar modelos sin depender de cómo redacta cada uno.
 *
 *   docker compose exec api npm run eval -- conversacion
 */
import 'dotenv/config';
import 'reflect-metadata';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../src/agents/openrouter.client.js';
import { CalendarService, type EventoListado } from '../src/calendar/calendar.service.js';
import { OPENROUTER_BASE_URL_POR_DEFECTO, type Env } from '../src/config/env.js';
import { LIMITE_RECURSION, construirGrafo } from '../src/conversation/graph/graph.factory.js';
import { llmProvider } from '../src/conversation/llm.provider.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { HAY_CLAVE, modelosDelEval } from './modelos.js';
import { guardarReporte, normalizar, type Resultado } from './reporte.js';

/** Lunes 14/09/2026 08:00 en Buenos Aires: "mañana" es martes y el sábado es el 19. */
const AHORA = new Date('2026-09-14T08:00:00-03:00');
const MARTES = '2026-09-15';

const USUARIO = { id: 'eval-owner', googleId: 'dev:eval@trato.local', googleRefreshToken: null, email: 'eval@trato.local' };

const AGENTE = {
  id: 'eval-agent',
  userId: USUARIO.id,
  tipoUso: 'consultorio',
  descripcion: 'Persona: Dra. Lucía Fernández (consultorio).',
  tipoTitular: 'persona',
  nombreTitular: 'Dra. Lucía Fernández',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [
    { nombre: 'Control', duracionMin: 30 },
    { nombre: 'Primera consulta', duracionMin: 45 },
  ],
  systemPrompt:
    'Sos Tati, la asistente de la Dra. Lucía Fernández, que atiende en su consultorio de lunes a viernes de 09:00 a 18:00. ' +
    'Tomás turnos de Control (30 min) y Primera consulta (45 min). Presentate como "Hola, soy Tati, la asistente de la Dra. Lucía Fernández". ' +
    'Antes de agendar preguntá lo que falte (día, horario, tipo de turno y nombre de la persona), consultá la disponibilidad ' +
    'y agendá, cancelá o reprogramá sólo cuando la persona confirme. Hablá únicamente de la agenda de la doctora; ' +
    'cualquier otro tema se rechaza en una línea. No inventes precios, dirección ni formas de pago: derivá a la doctora.',
  allowedActions: ['consultar_disponibilidad', 'crear_turno', 'cancelar_turno', 'reprogramar_turno', 'consultar_turno'],
  model: 'eval',
  createdAt: AHORA,
  updatedAt: AHORA,
  user: USUARIO,
};

type TurnoMemoria = {
  id: string;
  conversationId: string;
  googleEventId: string;
  nombreCliente: string | null;
  inicio: Date;
  fin: Date;
  estado: string;
  createdAt: Date;
};

/** Lo mínimo de Prisma que usa el grafo (cargar_contexto, calendar, persistir), con estado. */
function prismaEnMemoria() {
  const conversacion = {
    id: 'eval-conv',
    userId: USUARIO.id,
    remoteJid: '5491100000000@s.whatsapp.net',
    resumen: null as string | null,
    nombreCliente: null as string | null,
    createdAt: AHORA,
    updatedAt: AHORA,
  };
  const turnos: TurnoMemoria[] = [];
  let mensajes = 0;

  const prisma = {
    agent: { findUnique: async () => AGENTE },
    conversation: {
      findUniqueOrThrow: async () => ({ ...conversacion }),
      update: async ({ data }: { data: Partial<typeof conversacion> }) => Object.assign(conversacion, data),
    },
    turno: {
      findFirst: async () =>
        turnos.filter((turno) => turno.estado === 'confirmado').sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null,
      findMany: async ({ where }: { where: { estado?: string } }) =>
        turnos.filter((turno) => !where.estado || turno.estado === where.estado),
      create: async ({ data }: { data: Omit<TurnoMemoria, 'id' | 'createdAt'> }) => {
        const turno = { ...data, id: `turno-${turnos.length + 1}`, createdAt: new Date(Date.now() + turnos.length) };
        turnos.push(turno);
        return turno;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TurnoMemoria> }) => {
        const turno = turnos.find((candidato) => candidato.id === where.id)!;
        return Object.assign(turno, data);
      },
      updateMany: async () => ({ count: 0 }),
    },
    message: { create: async () => ({}), count: async () => ++mensajes },
  };
  return { prisma: prisma as unknown as PrismaService, turnos };
}

function configPara(modelo: string): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    NODE_ENV: 'development',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO,
    OPENROUTER_MODEL: modelo,
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

type Caso = {
  id: string;
  /** Turno ya agendado antes de empezar, martes a esta hora. */
  turnoPrevio?: string;
  mensajes: string[];
  check: (eventos: EventoListado[], respuestas: string[]) => Record<string, boolean>;
};

function horaBA(fecha: Date | null): string {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

function diaBA(fecha: Date | null): string {
  return fecha ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(fecha) : '';
}

const CONFIRMAR = 'Sí, dale, confirmo';

const CASOS: Caso[] = [
  {
    id: 'consulta-ambigua-no-agenda',
    mensajes: ['che el jueves a la tardecita tenés algo? sino el viernes temprano'],
    check: (eventos, [respuesta]) => ({
      noAgendaSinConfirmar: eventos.length === 0,
      respondeAlgo: respuesta.trim().length > 0,
      hablaDeLosDias: /jueves|viernes|\d{1,2}[:.]\d{2}/.test(normalizar(respuesta)),
    }),
  },
  {
    id: 'pedido-completo-en-un-mensaje',
    mensajes: ['Hola, soy Caro. Dame el martes a las 10 y cuarto para un control', CONFIRMAR],
    check: (eventos) => ({
      agendaUno: eventos.length === 1,
      horaCorrecta: eventos[0] !== undefined && diaBA(eventos[0].inicio) === MARTES && horaBA(eventos[0].inicio) === '10:15',
      aNombreDeCaro: eventos[0]?.resumen.includes('Caro') ?? false,
    }),
  },
  {
    id: 'mover-una-hora',
    turnoPrevio: '10:00',
    mensajes: ['mejor movelo una hora más tarde', CONFIRMAR],
    check: (eventos) => ({
      sigueHabiendoUno: eventos.length === 1,
      quedaALas11: eventos[0] !== undefined && diaBA(eventos[0].inicio) === MARTES && horaBA(eventos[0].inicio) === '11:00',
    }),
  },
  {
    id: 'cancelar-lo-del-martes',
    turnoPrevio: '10:00',
    mensajes: ['cancelá lo del martes porfa', CONFIRMAR],
    check: (eventos) => ({ cancela: eventos.length === 0 }),
  },
  {
    id: 'sabado-no',
    mensajes: ['quiero turno el sábado a las 10 para control, soy Juan', CONFIRMAR],
    check: (eventos) => ({ noAgendaFinDeSemana: eventos.every((evento) => ![0, 6].includes(evento.inicio!.getUTCDay())) }),
  },
  {
    id: 'no-inventa-precio',
    mensajes: ['cuánto sale la consulta y dónde queda? ah y si hay turno mañana a las 9 para control soy Ana'],
    check: (_eventos, [respuesta]) => ({
      sinPrecio: !/\$|\d+\s*(pesos|ars)/i.test(respuesta),
      sinDireccionInventada: !/\b(calle|av\.|avenida)\s+[a-z]/i.test(normalizar(respuesta)),
    }),
  },
];

describe.skipIf(!HAY_CLAVE)('eval: conversación con textos difíciles', () => {
  const resultados: Resultado[] = [];
  afterAll(() => guardarReporte('conversacion', resultados));

  beforeEach(() => {
    // Sólo Date: los timers reales siguen andando para los timeouts de red.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const modelo of modelosDelEval()) {
    for (const caso of CASOS) {
      it(`${modelo} · ${caso.id}`, async () => {
        const config = configPara(modelo);
        const { prisma, turnos } = prismaEnMemoria();
        const calendario = new CalendarService(config, prisma);
        const llm = llmProvider.useFactory(config);
        const grafo = construirGrafo({
          prisma,
          calendarService: calendario,
          llm,
          // El resumen de cliente no es lo que se evalúa.
          openRouter: { chat: async () => ({ content: 'Cliente de eval.' }) } as unknown as OpenRouterClient,
          checkpointer: new MemorySaver(),
        });

        if (caso.turnoPrevio) {
          const inicio = new Date(`${MARTES}T${caso.turnoPrevio}:00-03:00`);
          const fin = new Date(inicio.getTime() + 30 * 60_000);
          const googleEventId = await calendario.crearEvento(USUARIO, { resumen: 'Control - Caro', inicio, fin });
          await prisma.turno.create({
            data: { conversationId: 'eval-conv', googleEventId, nombreCliente: 'Caro', inicio, fin, estado: 'confirmado' },
          });
        }

        const resultado: Resultado = {
          modelo,
          caso: caso.id,
          ok: false,
          checks: {},
          latenciasMs: [],
          llamadas: 0,
          tokensSalida: 0,
          costoUsd: 0,
        };
        const respuestas: string[] = [];
        const herramientas: string[] = [];

        try {
          for (const texto of caso.mensajes) {
            const inicio = performance.now();
            const estado = await grafo.invoke(
              { messages: [new HumanMessage(texto)], ownerUserId: USUARIO.id, remoteJid: 'eval', esPropietario: false },
              { configurable: { thread_id: `${modelo}-${caso.id}` }, recursionLimit: LIMITE_RECURSION },
            );
            resultado.latenciasMs.push(Math.round(performance.now() - inicio));

            const nuevos = estado.messages.slice(-12).filter((mensaje) => mensaje instanceof AIMessage) as AIMessage[];
            for (const mensaje of nuevos) {
              for (const llamada of mensaje.tool_calls ?? []) herramientas.push(llamada.name);
            }
            const ultimo = estado.messages.at(-1);
            respuestas.push(typeof ultimo?.content === 'string' ? ultimo.content : '');
          }

          const eventos = await calendario.listarProximos(
            USUARIO,
            AHORA,
            new Date(AHORA.getTime() + 14 * 24 * 60 * 60_000),
          );
          resultado.checks = caso.check(eventos, respuestas);
        } catch (error) {
          resultado.error = (error as Error).message;
          resultado.checks = { corre: false };
        } finally {
          resultado.llamadas = herramientas.length;
          resultado.detalle = JSON.stringify({ respuestas, herramientas, turnos: turnos.length });
          resultado.ok = Object.values(resultado.checks).every(Boolean);
          resultados.push(resultado);
        }

        expect.soft(resultado.error, 'el grafo no debería fallar').toBeUndefined();
        for (const [check, paso] of Object.entries(resultado.checks)) {
          expect.soft(paso, check).toBe(true);
        }
      });
    }
  }
});
