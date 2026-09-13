/**
 * Helpers compartidos por los specs adversariales del grafo — mismo patrón que
 * `../graph.spec.ts` (no se importa desde ahí porque es un archivo de test,
 * no un módulo pensado para reuso). No es un `*.spec.ts`: no corre como test.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { vi } from 'vitest';
import type { OpenRouterClient } from '../../../agents/openrouter.client.js';
import type { CalendarService, PeriodoOcupado } from '../../../calendar/calendar.service.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { LIMITE_RECURSION, construirGrafo } from '../graph.factory.js';

/** Los tests trabajan en -03:00, la zona fija del proyecto. */
export function hora(iso: string, dia = '2026-09-01'): string {
  return `${dia}T${iso}:00-03:00`;
}

export const AGENT = {
  id: 'agent-1',
  userId: 'user-1',
  allowedActions: ['consultar_disponibilidad', 'crear_turno', 'reprogramar_turno', 'cancelar_turno'],
  systemPrompt: 'Sos Tati.',
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [{ nombre: 'Corte de pelo', duracionMin: 30 }],
  user: { id: 'user-1', googleRefreshToken: 'cifrado' },
};

export const CONVERSATION = {
  id: 'conv-1',
  userId: 'user-1',
  remoteJid: '54911@s.whatsapp.net',
  resumen: null as string | null,
  nombreCliente: null as string | null,
};

export const TURNO = {
  id: 'turno-1',
  googleEventId: 'evento-abc',
  inicio: new Date(hora('10:00')),
  fin: new Date(hora('10:30')),
};

export function crearPrisma(
  opciones: { turnoActivo?: typeof TURNO | null; agent?: Partial<typeof AGENT>; conversation?: Partial<typeof CONVERSATION> } = {},
) {
  const agent = { ...AGENT, ...opciones.agent };
  const conversation = { ...CONVERSATION, ...opciones.conversation };
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(agent) },
    conversation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(conversation),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...conversation, ...data })),
    },
    turno: {
      findFirst: vi.fn().mockResolvedValue(opciones.turnoActivo ?? null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'turno-nuevo', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...TURNO, ...data })),
    },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

export function crearCalendar(ocupados: PeriodoOcupado[] = []) {
  return {
    freeBusy: vi.fn().mockResolvedValue(ocupados),
    crearEvento: vi.fn().mockResolvedValue('evento-nuevo'),
    cancelarEvento: vi.fn().mockResolvedValue(undefined),
    reprogramarEvento: vi.fn().mockResolvedValue(undefined),
    listarProximos: vi.fn().mockResolvedValue([]),
  } as unknown as CalendarService;
}

/** Modelo falso: devuelve las respuestas preparadas, una por vuelta (se repite la última). */
export function crearModelo(respuestas: BaseMessage[]) {
  const invoke = vi.fn(async () => respuestas[Math.min(invoke.mock.calls.length - 1, respuestas.length - 1)]);
  const modelo = { invoke, bindTools: () => modelo };
  return modelo as unknown as BaseChatModel & { invoke: typeof invoke };
}

export function llamada(name: string, args: Record<string, unknown>, id = 'call-1') {
  return new AIMessage({ content: '', tool_calls: [{ id, name, args }] });
}

/** Un solo AIMessage con varias tool calls, como cuando el modelo agenda dos turnos de una. */
export function llamadas(...calls: { name: string; args: Record<string, unknown>; id?: string }[]) {
  return new AIMessage({
    content: '',
    tool_calls: calls.map((call, indice) => ({ id: call.id ?? `call-${indice}`, name: call.name, args: call.args })),
  });
}

export function correr(
  deps: { prisma: PrismaService; calendarService: CalendarService; llm: BaseChatModel },
  opciones: { esPropietario?: boolean; mensaje?: string; remoteJid?: string; threadId?: string; checkpointer?: MemorySaver } = {},
) {
  const grafo = construirGrafo({
    ...deps,
    openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
    checkpointer: opciones.checkpointer ?? new MemorySaver(),
  });
  return grafo.invoke(
    {
      messages: [new HumanMessage(opciones.mensaje ?? 'hola, quiero un turno')],
      ownerUserId: 'user-1',
      remoteJid: opciones.remoteJid ?? CONVERSATION.remoteJid,
      esPropietario: opciones.esPropietario ?? false,
    },
    { configurable: { thread_id: opciones.threadId ?? CONVERSATION.id }, recursionLimit: LIMITE_RECURSION },
  );
}
