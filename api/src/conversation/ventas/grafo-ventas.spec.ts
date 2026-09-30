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
import { YA_TE_PRESENTASTE } from './reglas-ventas.js';
import { PedidoRechazadoError } from '../../comercio/ventas.service.js';

const AGENT = {
  id: 'agent-1',
  userId: 'user-1',
  tipoAsistente: 'ventas',
  nombreTitular: 'Mates del Sur',
  nombreBot: 'Nina',
  ...construirConfiguracionVentas({ nombreTitular: 'Mates del Sur', nombreBot: 'Nina' }),
  user: { id: 'user-1' },
};

const CONVERSATION = { id: 'conv-1', userId: 'user-1', remoteJid: '5491122334455@s.whatsapp.net', resumen: null, nombreCliente: null };

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

function crearPrisma(opciones: { totalProductos?: number; mpConectado?: boolean; pedidos?: unknown[] } = {}) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: { findUniqueOrThrow: vi.fn().mockResolvedValue(CONVERSATION) },
    producto: {
      groupBy: vi.fn().mockResolvedValue([{ categoria: 'Mates', _count: { _all: 12 } }]),
      count: vi.fn().mockResolvedValue(opciones.totalProductos ?? 12),
    },
    cuentaMercadoPago: { findUnique: vi.fn().mockResolvedValue(opciones.mpConectado ? { id: 'mp-1' } : null) },
    venta: { findMany: vi.fn().mockResolvedValue(opciones.pedidos ?? []) },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

function crearNotificaciones(reciente = false) {
  return { avisar: vi.fn().mockResolvedValue({}), consultaRecienteDe: vi.fn().mockResolvedValue(reciente) };
}

const LISTADO = {
  ventas: [
    {
      createdAt: new Date('2026-09-26T20:42:00Z'),
      nombreCliente: 'Juan',
      estado: 'pagada',
      items: [{ nombreProducto: 'Mate', nombreVariante: '', cantidad: 2, subtotalCentavos: 1_600_000 }],
    },
  ],
  total: 1,
  pagina: 1,
  porPagina: 25,
  rango: { primerDia: '2026-09-20', ultimoDia: '2026-09-26' },
  totales: { cobradoCentavos: 1_600_000, pagadas: 1, ticketPromedioCentavos: 1_600_000, pendienteCentavos: 0, pendientes: 0 },
};

function crearHistorico() {
  return {
    listar: vi.fn().mockResolvedValue(LISTADO),
    resumen: vi.fn().mockResolvedValue({
      rango: LISTADO.rango,
      porDia: [],
      topProductos: [{ codigo: 'MATE', nombreProducto: 'Mate', unidades: 2, cobradoCentavos: 1_600_000 }],
    }),
  };
}

function crearVentas() {
  return {
    crearPedido: vi.fn(),
    pedidosDeConversacion: vi.fn().mockResolvedValue([]),
    cancelarUltimoPendiente: vi.fn().mockResolvedValue(null),
  };
}

const VENTA = {
  id: 'venta-1',
  nombreCliente: 'Juan',
  totalCentavos: 1_600_000,
  moneda: 'ARS',
  estado: 'pendiente_pago',
  medioPago: 'mercadopago',
  linkPago: 'https://mp/pagar/venta-1',
  reservaVenceAt: new Date('2099-01-01T15:30:00-03:00'),
  createdAt: new Date('2099-01-01T15:00:00-03:00'),
  items: [{ nombreProducto: 'Mate de calabaza', nombreVariante: '', cantidad: 2, subtotalCentavos: 1_600_000 }],
};

function crearModelo(respuestas: BaseMessage[]) {
  const invoke = vi.fn(async () => respuestas[Math.min(invoke.mock.calls.length - 1, respuestas.length - 1)]);
  const bindTools = vi.fn(() => modelo);
  const modelo = { invoke, bindTools };
  return modelo as unknown as BaseChatModel & { invoke: typeof invoke; bindTools: typeof bindTools };
}

function llamada(name: string, args: Record<string, unknown>) {
  return new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name, args }] });
}

function correr(
  deps: {
    prisma: PrismaService;
    llm: BaseChatModel;
    busqueda: Pick<BusquedaService, 'buscar'>;
    ventas?: ReturnType<typeof crearVentas>;
    notificaciones?: ReturnType<typeof crearNotificaciones>;
    historico?: ReturnType<typeof crearHistorico>;
  },
  esPropietario = false,
) {
  const grafo = construirGrafoVentas({
    ...deps,
    ventas: deps.ventas ?? crearVentas(),
    notificaciones: deps.notificaciones ?? crearNotificaciones(),
    historico: deps.historico ?? crearHistorico(),
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

  it('se presenta sólo en el primer mensaje: después el contexto le dice que ya lo hizo', async () => {
    const llm = crearModelo([new AIMessage('Hola, soy Nina. ¿Qué buscás?')]);
    const grafo = construirGrafoVentas({
      prisma: crearPrisma(),
      llm,
      busqueda: { buscar: vi.fn() },
      ventas: crearVentas(),
      notificaciones: crearNotificaciones(),
      historico: crearHistorico(),
      openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
      checkpointer: new MemorySaver(),
    });
    const config = { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION };
    const entrada = (texto: string) => ({
      messages: [new HumanMessage(texto)],
      ownerUserId: 'user-1',
      remoteJid: CONVERSATION.remoteJid,
      esPropietario: false,
    });

    await grafo.invoke(entrada('hola'), config);
    await grafo.invoke(entrada('¿tenés mates?'), config);

    const sistemas = (llm.invoke.mock.calls as unknown as Array<[BaseMessage[]]>).map(([mensajes]) => String(mensajes[0].content));
    expect(sistemas[0]).not.toContain(YA_TE_PRESENTASTE);
    expect(sistemas[0]).toContain('Primera vez que te escribe este número');
    expect(sistemas[1]).toContain(YA_TE_PRESENTASTE);
    // Todavía no hay resumen (se calcula cada 6 mensajes): el contexto no puede
    // seguir diciendo que es la primera vez, porque eso lo hacía saludar de nuevo.
    expect(sistemas[1]).not.toContain('Primera vez que te escribe este número');
  });

  it('cierra la venta preguntando si quiere algo más, sin pedir confirmación', async () => {
    const llm = crearModelo([new AIMessage('ok')]);
    await correr({ prisma: crearPrisma({ mpConectado: true }), llm, busqueda: { buscar: vi.fn() } });

    const sistema = sistemaDe(llm);
    expect(sistema).toContain('¿Querés algo más antes de que te pase el link de pago?');
    expect(sistema).toContain('No le pidas que confirme el pedido');
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

  describe('pedidos', () => {
    const itemsPedido = [
      { varianteId: 'v-1', cantidad: 1 },
      { varianteId: 'v-1', cantidad: 1 },
    ];

    it('crea el pedido con Mercado Pago si el comercio lo conectó y le pasa el link al modelo', async () => {
      const ventas = crearVentas();
      ventas.crearPedido.mockResolvedValue(VENTA);
      const llm = crearModelo([
        llamada('crear_pedido', { nombreCliente: ' Juan ', items: itemsPedido }),
        new AIMessage('Listo, te paso el link.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma({ mpConectado: true }), llm, busqueda: { buscar: vi.fn() }, ventas });

      expect(ventas.crearPedido).toHaveBeenCalledWith({
        userId: 'user-1',
        conversationId: 'conv-1',
        remoteJid: CONVERSATION.remoteJid,
        nombreCliente: 'Juan',
        // Los renglones repetidos llegan juntos.
        items: [{ varianteId: 'v-1', cantidad: 2 }],
        medioPago: 'mercadopago',
        dePrueba: false,
      });
      const [tool] = toolMessages(resultado.messages);
      expect(tool.content).toContain('Pedido creado para "Juan": 2 × Mate de calabaza ($ 16.000). Total $ 16.000.');
      expect(tool.content).toContain('https://mp/pagar/venta-1');
      expect(sistemaDe(llm)).toContain('Cobro: con link de pago de Mercado Pago');
    });

    it('sin Mercado Pago el pedido queda para coordinar, y desde el banco de pruebas va marcado', async () => {
      const ventas = crearVentas();
      ventas.crearPedido.mockResolvedValue({ ...VENTA, linkPago: null, medioPago: 'manual' });
      const llm = crearModelo([
        llamada('crear_pedido', { nombreCliente: 'Juan', items: [{ varianteId: 'v-1', cantidad: 2 }] }),
        new AIMessage('Anotado.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, ventas }, true);

      expect(ventas.crearPedido).toHaveBeenCalledWith(expect.objectContaining({ medioPago: 'manual', dePrueba: true }));
      expect(toolMessages(resultado.messages)[0].content).toContain('Mates del Sur se va a comunicar por este chat');
      expect(sistemaDe(llm)).toContain('no cobra con link por ahora');
    });

    it('sin nombre o con cantidades imposibles no llega a crear nada', async () => {
      const ventas = crearVentas();
      const sinNombre = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('crear_pedido', { nombreCliente: '', items: itemsPedido }), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        ventas,
      });
      expect(toolMessages(sinNombre.messages)[0].content).toContain('Falta el nombre');

      const cantidad = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([
          llamada('crear_pedido', { nombreCliente: 'Juan', items: [{ varianteId: 'v-1', cantidad: 500 }] }),
          new AIMessage('.'),
        ]),
        busqueda: { buscar: vi.fn() },
        ventas,
      });
      expect(toolMessages(cantidad.messages)[0].content).toContain('hasta 50 unidades');
      expect(ventas.crearPedido).not.toHaveBeenCalled();
    });

    it('un rechazo de negocio (sin stock) vuelve al modelo como texto', async () => {
      const ventas = crearVentas();
      ventas.crearPedido.mockRejectedValue(new PedidoRechazadoError('No hay stock suficiente de "Mate" para 2 unidades: queda 1 unidad.'));
      const resultado = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('crear_pedido', { nombreCliente: 'Juan', items: itemsPedido }), new AIMessage('Perdón.')]),
        busqueda: { buscar: vi.fn() },
        ventas,
      });
      expect(toolMessages(resultado.messages)[0].content).toBe(
        'No se pudo crear el pedido: No hay stock suficiente de "Mate" para 2 unidades: queda 1 unidad.',
      );
    });

    it('consulta y cancela los pedidos de esta conversación', async () => {
      const ventas = crearVentas();
      ventas.pedidosDeConversacion.mockResolvedValue([VENTA]);
      ventas.cancelarUltimoPendiente.mockResolvedValue({ ...VENTA, estado: 'cancelada' });

      const consulta = await correr({
        prisma: crearPrisma({ pedidos: [VENTA] }),
        llm: crearModelo([llamada('consultar_pedido', {}), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        ventas,
      });
      expect(toolMessages(consulta.messages)[0].content).toContain('pendiente de pago. Link de pago vigente');

      const cancelacion = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('cancelar_pedido', {}), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        ventas,
      });
      expect(ventas.cancelarUltimoPendiente).toHaveBeenCalledWith('conv-1');
      expect(toolMessages(cancelacion.messages)[0].content).toContain('Pedido cancelado y reserva liberada');
    });
  });

  describe('derivar_consulta', () => {
    it('le avisa al dueño con el número del cliente y le dice al modelo qué contestar', async () => {
      const notificaciones = crearNotificaciones();
      const resultado = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('derivar_consulta', { resumen: '¿Hacen envíos a Rosario?' }), new AIMessage('Le aviso.')]),
        busqueda: { buscar: vi.fn() },
        notificaciones,
      });

      expect(notificaciones.avisar).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          tipo: 'consulta_derivada',
          titulo: 'Consulta de un cliente',
          cuerpo: expect.stringContaining('Un cliente (+5491122334455) preguntó algo que el asistente no sabe responder: "¿Hacen envíos a Rosario?"'),
          clave: 'consulta:conv-1',
        }),
      );
      expect(toolMessages(resultado.messages)[0].content).toBe(
        'Listo, le avisé a Mates del Sur. Decile al cliente que Mates del Sur le va a responder por este chat.',
      );
    });

    it('no molesta dos veces al dueño con la misma conversación', async () => {
      const notificaciones = crearNotificaciones(true);
      const resultado = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('derivar_consulta', { resumen: 'otra vez' }), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        notificaciones,
      });
      expect(notificaciones.avisar).not.toHaveBeenCalled();
      expect(toolMessages(resultado.messages)[0].content).toContain('no lo vuelvo a molestar');
    });
  });

  describe('herramientas del dueño', () => {
    it('listar_ventas y resumen_ventas no existen para un cliente', async () => {
      const historico = crearHistorico();
      const resultado = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('listar_ventas', {}), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        historico,
      });
      expect(toolMessages(resultado.messages)[0].content).toContain('no existe');
      expect(historico.listar).not.toHaveBeenCalled();
    });

    it('el dueño ve sus ventas y el resumen del período', async () => {
      const historico = crearHistorico();
      const listado = await correr(
        {
          prisma: crearPrisma(),
          llm: crearModelo([llamada('listar_ventas', { desde: '2026-09-20', hasta: '2026-09-26' }), new AIMessage('.')]),
          busqueda: { buscar: vi.fn() },
          historico,
        },
        true,
      );
      expect(historico.listar).toHaveBeenCalledWith('user-1', { desde: '2026-09-20', hasta: '2026-09-26', estado: undefined });
      expect(toolMessages(listado.messages)[0].content).toBe(
        'Ventas del 20/9 al 26/9: cobrado $ 16.000 en 1 venta pagada.\n' +
          '- sábado 26/9 a las 17:42 · Juan · 2 × Mate ($ 16.000) · pagada',
      );

      const resumen = await correr(
        {
          prisma: crearPrisma(),
          llm: crearModelo([llamada('resumen_ventas', {}), new AIMessage('.')]),
          busqueda: { buscar: vi.fn() },
          historico,
        },
        true,
      );
      expect(toolMessages(resumen.messages)[0].content).toBe(
        'Del 20/9 al 26/9: cobrado $ 16.000 en 1 venta (ticket promedio $ 16.000). Lo más vendido: Mate (2 u., $ 16.000).',
      );
    });

    it('rechaza fechas mal escritas sin consultar nada', async () => {
      const historico = crearHistorico();
      const resultado = await correr(
        {
          prisma: crearPrisma(),
          llm: crearModelo([llamada('resumen_ventas', { desde: 'ayer' }), new AIMessage('.')]),
          busqueda: { buscar: vi.fn() },
          historico,
        },
        true,
      );
      expect(toolMessages(resultado.messages)[0].content).toBe('desde tiene que ser un día AAAA-MM-DD.');
      expect(historico.resumen).not.toHaveBeenCalled();
    });
  });
});
