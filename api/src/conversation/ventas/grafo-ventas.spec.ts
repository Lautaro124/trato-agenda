import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { ACCIONES_VENTAS_IDS } from '../../agents/agent-catalog.js';
import { construirConfiguracionVentas } from '../../agents/agent-template-ventas.js';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { BusquedaService, ProductoEncontrado } from '../../comercio/busqueda.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LIMITE_RECURSION } from '../graph/graph.factory.js';
import { construirGrafoVentas } from './grafo-ventas.factory.js';
import { MENSAJE_CATALOGO_CAIDO } from './nodes/catalogo.node.js';

const AGENT = {
  id: 'agent-1',
  userId: 'user-1',
  tipoAsistente: 'ventas',
  nombreTitular: 'Mates del Sur',
  nombreBot: 'Nina',
  ...construirConfiguracionVentas({ nombreTitular: 'Mates del Sur', nombreBot: 'Nina' }),
  user: { id: 'user-1' },
};

const CONVERSATION = { id: 'conv-1', userId: 'user-1', remoteJid: '54911@s.whatsapp.net', resumen: null, nombreCliente: null };

const MATE: ProductoEncontrado = {
  productoId: 'p-1',
  codigo: 'MATE-01',
  nombre: 'Mate de calabaza',
  categoria: 'Mates',
  descripcion: 'Curado, con virola de alpaca',
  variantes: [
    {
      varianteId: 'v-1',
      sku: 'MATE-01',
      nombre: '',
      precioCentavos: 800_000,
      hayStock: true,
      stock: 'quedan 2 unidades',
      unidades: 2,
      reservadas: 1,
      stockMinimo: 1,
    },
  ],
};

function crearPrisma(opciones: { totalProductos?: number } = {}) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: { findUniqueOrThrow: vi.fn().mockResolvedValue(CONVERSATION) },
    producto: {
      groupBy: vi.fn().mockResolvedValue([{ categoria: 'Mates', _count: { _all: 12 } }]),
      count: vi.fn().mockResolvedValue(opciones.totalProductos ?? 12),
    },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

function crearModelo(respuestas: BaseMessage[]) {
  const invoke = vi.fn(async () => respuestas[Math.min(invoke.mock.calls.length - 1, respuestas.length - 1)]);
  const bindTools = vi.fn(() => modelo);
  const modelo = { invoke, bindTools };
  return modelo as unknown as BaseChatModel & { invoke: typeof invoke; bindTools: typeof bindTools };
}

function llamada(name: string, args: Record<string, unknown>) {
  return new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name, args }] });
}

function correr(deps: { prisma: PrismaService; llm: BaseChatModel; busqueda: Pick<BusquedaService, 'buscar'> }, esPropietario = false) {
  const grafo = construirGrafoVentas({
    ...deps,
    openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
    checkpointer: new MemorySaver(),
  });
  return grafo.invoke(
    { messages: [new HumanMessage('¿tenés mates?')], ownerUserId: 'user-1', remoteJid: CONVERSATION.remoteJid, esPropietario },
    { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION },
  );
}

function sistemaDe(llm: { invoke: ReturnType<typeof vi.fn> }): string {
  const [mensajes] = llm.invoke.mock.calls[0] as unknown as [BaseMessage[]];
  return String(mensajes[0].content);
}

function toolMessages(mensajes: BaseMessage[]): ToolMessage[] {
  return mensajes.filter((mensaje): mensaje is ToolMessage => mensaje.getType() === 'tool');
}

describe('grafo de ventas', () => {
  it('le pasa al modelo el prompt de ventas con las categorías, sin productos', async () => {
    const llm = crearModelo([new AIMessage('Hola, soy Nina.')]);
    await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() } });

    const sistema = sistemaDe(llm);
    expect(sistema).toContain(AGENT.systemPrompt);
    expect(sistema).toContain('Reglas de venta de Mates del Sur');
    expect(sistema).toContain('existís sólo para vender los productos de Mates del Sur');
    expect(sistema).toContain('Catálogo: 12 productos en estas categorías: "Mates" (12)');
    expect(sistema).not.toContain('lunes a viernes');
  });

  it('avisa al modelo cuando el catálogo está vacío', async () => {
    const llm = crearModelo([new AIMessage('Hola.')]);
    await correr({ prisma: crearPrisma({ totalProductos: 0 }), llm, busqueda: { buscar: vi.fn() } });
    expect(sistemaDe(llm)).toContain('todavía no cargó productos');
  });

  it('a un cliente le ofrece sólo las herramientas de venta', async () => {
    const llm = crearModelo([new AIMessage('Hola.')]);
    await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() } });
    const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
    expect(herramientas.map((h) => h.name)).toEqual(ACCIONES_VENTAS_IDS);
  });

  it('busca en el catálogo y le devuelve al modelo precios, stock e ids de variante', async () => {
    const buscar = vi.fn().mockResolvedValue([MATE]);
    const llm = crearModelo([llamada('buscar_productos', { consulta: ' mates ' }), new AIMessage('Tengo el mate a $ 8.000.')]);
    const prisma = crearPrisma();

    const resultado = await correr({ prisma, llm, busqueda: { buscar } });

    expect(buscar).toHaveBeenCalledWith('user-1', 'mates', { categoria: undefined });
    const [tool] = toolMessages(resultado.messages);
    expect(tool.content).toContain('"Mate de calabaza" (código MATE-01');
    expect(tool.content).toContain('[variante v-1]: $ 8.000, quedan 2 unidades');
    // Al cliente nunca le llega el stock exacto del dueño.
    expect(tool.content).not.toContain('reservadas');
    expect(resultado.messages.at(-1)?.content).toBe('Tengo el mate a $ 8.000.');
    // Humano, tool call, tool result y respuesta final.
    expect(prisma.message.create).toHaveBeenCalledTimes(4);
  });

  it('rechaza herramientas de la agenda sin tocar el catálogo', async () => {
    const buscar = vi.fn();
    const llm = crearModelo([llamada('crear_turno', { nombreCliente: 'Juan' }), new AIMessage('Perdón.')]);

    const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar } });

    expect(buscar).not.toHaveBeenCalled();
    expect(toolMessages(resultado.messages)[0].content).toContain('La herramienta crear_turno no existe');
  });

  it('rechaza argumentos inválidos o una consulta vacía', async () => {
    const buscar = vi.fn();
    const llm = crearModelo([llamada('buscar_productos', { consulta: '   ' }), new AIMessage('¿Qué buscás?')]);

    const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar } });

    expect(buscar).not.toHaveBeenCalled();
    expect(toolMessages(resultado.messages)[0].content).toContain('La consulta está vacía');
  });

  it('consultar_stock es sólo para el dueño', async () => {
    const buscar = vi.fn().mockResolvedValue([MATE]);

    const cliente = await correr({
      prisma: crearPrisma(),
      llm: crearModelo([llamada('consultar_stock', { consulta: 'mate' }), new AIMessage('.')]),
      busqueda: { buscar },
    });
    expect(toolMessages(cliente.messages)[0].content).toContain('no existe');
    expect(buscar).not.toHaveBeenCalled();

    const dueno = await correr(
      {
        prisma: crearPrisma(),
        llm: crearModelo([llamada('consultar_stock', { consulta: 'mate' }), new AIMessage('.')]),
        busqueda: { buscar },
      },
      true,
    );
    expect(toolMessages(dueno.messages)[0].content).toContain('2 disponibles (+1 reservadas), mínimo 1');
  });

  it('si la búsqueda falla, el modelo recibe la disculpa en vez de romper el grafo', async () => {
    const buscar = vi.fn().mockRejectedValue(new Error('base caída'));
    const llm = crearModelo([llamada('buscar_productos', { consulta: 'mate' }), new AIMessage('Perdón, probá en un rato.')]);

    const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar } });

    expect(toolMessages(resultado.messages)[0].content).toBe(MENSAJE_CATALOGO_CAIDO);
    expect(resultado.messages.at(-1)?.content).toBe('Perdón, probá en un rato.');
  });
});
