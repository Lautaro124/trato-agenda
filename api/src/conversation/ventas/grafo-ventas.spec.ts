import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ACCIONES_VENTAS_IDS } from '../../agents/agent-catalog.js';
import { construirConfiguracionVentas } from '../../agents/agent-template-ventas.js';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { BusquedaService, ProductoEncontrado } from '../../comercio/busqueda.service.js';
import type { ImagenesService } from '../../comercio/imagenes.service.js';
import type { DescuentoAplicado, DescuentosVigentes } from '../../comercio/descuentos.rules.js';
import type { SugerenciasService } from '../../comercio/sugerencias.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MENSAJE_PRECIO_SIN_VERIFICAR } from '../mensajes.js';
import { conMarcaDeLlegada } from '../graph/ventana-historial.js';
import { LIMITE_RECURSION_VENTAS, construirGrafoVentas } from './grafo-ventas.factory.js';
import { MAX_IMAGENES_POR_MENSAJE } from '../../comercio/imagenes.rules.js';
import { imagenesDeLaVuelta } from './imagenes-de-la-vuelta.js';
import { MENSAJE_CATALOGO_CAIDO } from './nodes/catalogo.node.js';
import { OFERTA_DE_DESCUENTOS, YA_TE_PRESENTASTE } from './reglas-ventas.js';
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
  tieneImagen: false,
  variantes: [
    {
      varianteId: 'v-1',
      sku: 'MATE-01',
      nombre: '',
      precioCentavos: 800_000,
      precioFinalCentavos: 800_000,
      descuento: null,
      hayStock: true,
      stock: 'quedan 2 unidades',
      unidades: 2,
      reservadas: 1,
      stockMinimo: 1,
    },
  ],
};

function crearPrisma(
  opciones: {
    totalProductos?: number;
    mpConectado?: boolean;
    pedidos?: unknown[];
    pedidosAMedida?: unknown[];
    /** Productos a medida activos de la cuenta: con alguno se suman sus reglas y herramientas. */
    productosAMedida?: number;
    agent?: Record<string, unknown>;
  } = {},
) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(opciones.agent ?? AGENT) },
    conversation: { findUniqueOrThrow: vi.fn().mockResolvedValue(CONVERSATION) },
    producto: {
      groupBy: vi.fn().mockResolvedValue([{ categoria: 'Mates', _count: { _all: 12 } }]),
      count: vi.fn().mockImplementation((args: { where?: { solicitud?: unknown } }) =>
        Promise.resolve(args?.where?.solicitud ? (opciones.productosAMedida ?? 0) : (opciones.totalProductos ?? 12)),
      ),
    },
    cuentaMercadoPago: { findUnique: vi.fn().mockResolvedValue(opciones.mpConectado ? { id: 'mp-1' } : null) },
    venta: {
      findMany: vi.fn().mockImplementation((args: { where?: { tipo?: string } }) =>
        Promise.resolve(args?.where?.tipo === 'a_medida' ? (opciones.pedidosAMedida ?? []) : (opciones.pedidos ?? [])),
      ),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    message: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

const SIN_DESCUENTOS: DescuentosVigentes = { promociones: [], productos: [], restantes: 0 };
const sinDescuentos = () => vi.fn().mockResolvedValue(SIN_DESCUENTOS);

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

function crearPedidosAMedida() {
  return {
    productoParaSolicitud: vi.fn().mockResolvedValue(null),
    cotizacionPrevia: vi.fn().mockResolvedValue(null),
    registrarSolicitud: vi.fn(),
    cotizarSolicitud: vi.fn().mockResolvedValue({ modo: 'manual' }),
    cobrar: vi.fn(),
    derivar: vi.fn(),
    varianteParaPedir: vi.fn().mockResolvedValue(null),
    pedirVariante: vi.fn(),
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

function llamada(name: string, args: Record<string, unknown>, id = 'call-1') {
  return new AIMessage({ content: '', tool_calls: [{ id, name, args }] });
}

/** El pedido sólo acepta variantes que salieron de una búsqueda: primero se busca el mate. */
const BUSCAR_MATE = llamada('buscar_productos', { consulta: 'mate' }, 'call-busqueda');
const buscaMate = () => ({ buscar: vi.fn().mockResolvedValue([MATE]) });

function resultadoDe(mensajes: BaseMessage[], nombre: string): ToolMessage {
  return toolMessages(mensajes).filter((mensaje) => mensaje.name === nombre).at(-1) as ToolMessage;
}

function correr(
  deps: {
    prisma: PrismaService;
    llm: BaseChatModel;
    busqueda: Pick<BusquedaService, 'buscar'>;
    sugerencias?: Partial<Pick<SugerenciasService, 'verCatalogo' | 'descuentosVigentes'>>;
    ventas?: ReturnType<typeof crearVentas>;
    notificaciones?: ReturnType<typeof crearNotificaciones>;
    historico?: ReturnType<typeof crearHistorico>;
    pedidos?: ReturnType<typeof crearPedidosAMedida>;
    imagenes?: Pick<ImagenesService, 'estadoDeFoto'>;
    decisiones?: { ordenar: Mock<(pedido: unknown) => Promise<string[]>>; configurado: boolean };
  },
  esPropietario = false,
  mensajes: BaseMessage[] = [new HumanMessage('¿tenés mates?')],
) {
  const grafo = construirGrafoVentas({
    ...deps,
    sugerencias: { verCatalogo: vi.fn(), descuentosVigentes: sinDescuentos(), ...deps.sugerencias },
    ventas: deps.ventas ?? crearVentas(),
    notificaciones: deps.notificaciones ?? crearNotificaciones(),
    historico: deps.historico ?? crearHistorico(),
    imagenes: deps.imagenes ?? { estadoDeFoto: vi.fn() },
    pedidos: deps.pedidos ?? crearPedidosAMedida(),
    openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
    checkpointer: new MemorySaver(),
  });
  return grafo.invoke(
    { messages: mensajes, ownerUserId: 'user-1', remoteJid: CONVERSATION.remoteJid, esPropietario },
    { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION_VENTAS },
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
    // Sin local cargado no afirma nada: la consulta se deriva.
    expect(sistema).toContain('Local: no sabés si Mates del Sur tiene local a la calle');
  });

  it('con local cargado, el prompt trae su dirección, horarios y retiro', async () => {
    const llm = crearModelo([new AIMessage('Estamos en Belgrano 100.')]);
    const local = {
      tieneLocal: true,
      direccion: 'Belgrano 100',
      horarios: [{ dia: 'sab', desde: '10:00', hasta: '13:00' }],
      retiroEnLocal: true,
    };
    await correr({ prisma: crearPrisma({ agent: { ...AGENT, local } }), llm, busqueda: { buscar: vi.fn() } });

    const sistema = sistemaDe(llm);
    expect(sistema).toContain('Local de Mates del Sur');
    expect(sistema).toContain('- Dirección: "Belgrano 100".');
    expect(sistema).toContain('- Horarios: sábado de 10:00 a 13:00.');
    expect(sistema).toContain('Se pueden retirar las compras en el local');
  });

  it('se presenta sólo en el primer mensaje: después el contexto le dice que ya lo hizo', async () => {
    const llm = crearModelo([new AIMessage('Hola, soy Nina. ¿Qué buscás?')]);
    const grafo = construirGrafoVentas({
      prisma: crearPrisma(),
      llm,
      busqueda: { buscar: vi.fn() },
      sugerencias: { verCatalogo: vi.fn(), descuentosVigentes: sinDescuentos() },
      ventas: crearVentas(),
      notificaciones: crearNotificaciones(),
      historico: crearHistorico(),
      imagenes: { estadoDeFoto: vi.fn() },
      pedidos: crearPedidosAMedida(),
      openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
      checkpointer: new MemorySaver(),
    });
    const config = { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION_VENTAS };
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
    // Las de los pedidos a medida sólo están si la cuenta tiene algún producto a medida.
    const aMedida = ['registrar_solicitud', 'pedir_variante', 'aceptar_presupuesto', 'derivar_a_persona'];
    expect(herramientas.map((h) => h.name)).toEqual(ACCIONES_VENTAS_IDS.filter((id) => !aMedida.includes(id)));
  });

  it('busca en el catálogo y le devuelve al modelo precios, stock e ids de variante', async () => {
    const buscar = vi.fn().mockResolvedValue([MATE]);
    const llm = crearModelo([llamada('buscar_productos', { consulta: ' mates ' }), new AIMessage('Tengo el mate a $ 8.000.')]);
    const prisma = crearPrisma();

    const resultado = await correr({ prisma, llm, busqueda: { buscar } });

    expect(buscar).toHaveBeenCalledWith('user-1', 'mates', { categoria: undefined });
    const [tool] = toolMessages(resultado.messages);
    expect(tool.content).toContain('"Mate de calabaza" [producto p-1] (código MATE-01');
    expect(tool.content).toContain('[variante v-1]: $ 8.000, quedan 2 unidades');
    // Al cliente nunca le llega el stock exacto del dueño.
    expect(tool.content).not.toContain('reservadas');
    expect(resultado.messages.at(-1)?.content).toBe('Tengo el mate a $ 8.000.');
    // Humano, tool call, tool result y respuesta final.
    expect(prisma.message.create).toHaveBeenCalledTimes(4);
  });

  describe('descuentos', () => {
    const APLICADO: DescuentoAplicado = {
      descuentoId: 'd-1',
      alcance: 'producto',
      precioListaCentavos: 1_000_000,
      descuentoCentavos: 200_000,
      precioFinalCentavos: 800_000,
      etiqueta: '20% off',
      nombre: '',
      hastaDia: null,
    };
    const VIGENTES: DescuentosVigentes = {
      promociones: [{ nombre: 'Semana del mate', etiqueta: '10% off', categoria: 'Mates', hastaDia: '2026-10-31' }],
      productos: [
        { nombre: 'Mate imperial', precioFinalCentavos: 800_000, precioListaCentavos: 1_000_000, variosPrecios: false, aplicado: APLICADO },
      ],
      restantes: 0,
    };
    const conDescuentos = () => vi.fn().mockResolvedValue(VIGENTES);

    function grafoCon(deps: {
      llm: BaseChatModel;
      descuentosVigentes: SugerenciasService['descuentosVigentes'];
      agent?: Record<string, unknown>;
    }) {
      const grafo = construirGrafoVentas({
        prisma: crearPrisma({ agent: deps.agent }),
        llm: deps.llm,
        busqueda: buscaMate(),
        sugerencias: { verCatalogo: vi.fn(), descuentosVigentes: deps.descuentosVigentes },
        ventas: crearVentas(),
        notificaciones: crearNotificaciones(),
        historico: crearHistorico(),
        imagenes: { estadoDeFoto: vi.fn() },
        openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
        checkpointer: new MemorySaver(),
      });
      const config = { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION_VENTAS };
      return (texto: string) =>
        grafo.invoke(
          { messages: [new HumanMessage(texto)], ownerUserId: 'user-1', remoteJid: CONVERSATION.remoteJid, esPropietario: false },
          config,
        );
    }

    it('con descuentos vigentes, el resultado que muestra productos le pide ofrecerlos', async () => {
      const llm = crearModelo([BUSCAR_MATE, new AIMessage('Tengo Mate de calabaza a $ 8.000.')]);
      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), sugerencias: { descuentosVigentes: conDescuentos() } });

      const contenido = String(resultadoDe(resultado.messages, 'buscar_productos').content);
      expect(contenido).toContain('[variante v-1]: $ 8.000');
      expect(contenido).toContain(OFERTA_DE_DESCUENTOS);
      expect(contenido).toContain('ofrecele pasárselos');
    });

    it('también al mostrar el catálogo, pero no si no hay nada con stock', async () => {
      const listado = { tipo: 'listado', productos: [], categoria: null, restantes: 0 };
      const conProductos = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('ver_catalogo', {}), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        sugerencias: { verCatalogo: vi.fn().mockResolvedValue(listado), descuentosVigentes: conDescuentos() },
      });
      expect(toolMessages(conProductos.messages)[0].content).toContain(OFERTA_DE_DESCUENTOS);

      const vacio = await correr({
        prisma: crearPrisma(),
        llm: crearModelo([llamada('ver_catalogo', {}), new AIMessage('.')]),
        busqueda: { buscar: vi.fn() },
        sugerencias: { verCatalogo: vi.fn().mockResolvedValue({ tipo: 'vacio' }), descuentosVigentes: conDescuentos() },
      });
      expect(toolMessages(vacio.messages)[0].content).not.toContain(OFERTA_DE_DESCUENTOS);
    });

    it('sin descuentos vigentes no ofrece nada', async () => {
      const llm = crearModelo([BUSCAR_MATE, new AIMessage('Tengo Mate de calabaza a $ 8.000.')]);
      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate() });
      expect(resultadoDe(resultado.messages, 'buscar_productos').content).not.toContain(OFERTA_DE_DESCUENTOS);
    });

    it('los ofrece una sola vez por charla, aunque busque de nuevo en otro mensaje', async () => {
      const descuentosVigentes = conDescuentos();
      const llm = crearModelo([
        BUSCAR_MATE,
        new AIMessage('Tengo Mate de calabaza a $ 8.000. Además tenemos descuentos, si querés te los paso.'),
        llamada('buscar_productos', { consulta: 'mate' }, 'call-otra'),
        new AIMessage('Tengo Mate de calabaza a $ 8.000.'),
      ]);
      const escribir = grafoCon({ llm, descuentosVigentes });

      await escribir('¿tenés mates?');
      const resultado = await escribir('¿y otro mate?');

      const busquedas = toolMessages(resultado.messages).filter((mensaje) => mensaje.name === 'buscar_productos');
      expect(busquedas).toHaveLength(2);
      expect(busquedas[0].content).toContain(OFERTA_DE_DESCUENTOS);
      expect(busquedas[1].content).not.toContain(OFERTA_DE_DESCUENTOS);
      expect(descuentosVigentes).toHaveBeenCalledTimes(1);
    });

    it('con dos búsquedas en la misma vuelta, la oferta va sólo en la primera', async () => {
      const llm = crearModelo([
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'b1', name: 'buscar_productos', args: { consulta: 'mate' } },
            { id: 'b2', name: 'buscar_productos', args: { consulta: 'mate imperial' } },
          ],
        }),
        new AIMessage('Tengo Mate de calabaza a $ 8.000.'),
      ]);
      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), sugerencias: { descuentosVigentes: conDescuentos() } });

      const [primera, segunda] = toolMessages(resultado.messages);
      expect(primera.content).toContain(OFERTA_DE_DESCUENTOS);
      expect(segunda.content).not.toContain(OFERTA_DE_DESCUENTOS);
    });

    it('si en la misma vuelta ya pide ver_descuentos, la búsqueda no trae la oferta', async () => {
      const llm = crearModelo([
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'b1', name: 'buscar_productos', args: { consulta: 'mate' } },
            { id: 'd1', name: 'ver_descuentos', args: {} },
          ],
        }),
        new AIMessage('Tengo Mate de calabaza a $ 8.000.'),
      ]);
      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), sugerencias: { descuentosVigentes: conDescuentos() } });

      expect(resultadoDe(resultado.messages, 'buscar_productos').content).not.toContain(OFERTA_DE_DESCUENTOS);
      expect(resultadoDe(resultado.messages, 'ver_descuentos').content).toContain('Descuentos vigentes');
    });

    it('si leer los descuentos falla, la búsqueda llega igual, sin la oferta', async () => {
      const llm = crearModelo([BUSCAR_MATE, new AIMessage('Tengo Mate de calabaza a $ 8.000.')]);
      const resultado = await correr({
        prisma: crearPrisma(),
        llm,
        busqueda: buscaMate(),
        sugerencias: { descuentosVigentes: vi.fn().mockRejectedValue(new Error('se cayó la base')) },
      });

      const contenido = String(resultadoDe(resultado.messages, 'buscar_productos').content);
      expect(contenido).toContain('[variante v-1]: $ 8.000');
      expect(contenido).not.toContain(OFERTA_DE_DESCUENTOS);
    });

    it('ver_descuentos le pasa todos, aun a un agente creado antes de la herramienta, y después no los vuelve a ofrecer', async () => {
      const viejo = { ...AGENT, allowedActions: ACCIONES_VENTAS_IDS.filter((id) => id !== 'ver_descuentos') };
      const descuentosVigentes = conDescuentos();
      const llm = crearModelo([
        llamada('ver_descuentos', {}, 'call-descuentos'),
        new AIMessage('Tenemos estos descuentos: ...'),
        BUSCAR_MATE,
        new AIMessage('Tengo Mate de calabaza a $ 8.000.'),
      ]);
      const escribir = grafoCon({ llm, descuentosVigentes, agent: viejo });

      await escribir('¿qué descuentos tienen?');
      const resultado = await escribir('¿tenés mates?');

      const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
      expect(herramientas.map((h) => h.name)).toContain('ver_descuentos');
      const descuentos = String(resultadoDe(resultado.messages, 'ver_descuentos').content);
      expect(descuentos).toContain('pasale todos al cliente');
      expect(descuentos).toContain('- Promo "Semana del mate": 10% off en la categoría "Mates" hasta el 31/10');
      expect(descuentos).toContain('- "Mate imperial": $ 8.000, antes $ 10.000 (20% off; ahorra $ 2.000)');
      expect(resultadoDe(resultado.messages, 'buscar_productos').content).not.toContain(OFERTA_DE_DESCUENTOS);
      expect(descuentosVigentes).toHaveBeenCalledTimes(1);
    });

    it('el prompt le dice que use ver_descuentos cuando le piden descuentos', async () => {
      const llm = crearModelo([new AIMessage('Hola.')]);
      await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() } });
      expect(sistemaDe(llm)).toContain('llamá ver_descuentos y pasale todos los que te devuelve');
    });
  });

  describe('ver_catalogo', () => {
    const PRODUCTOS = [
      { productoId: 'p-1', nombre: 'Mate de calabaza', categoria: 'Mates', descripcion: '', precioDesdeCentavos: 800_000, variosPrecios: false },
      { productoId: 'p-2', nombre: 'Termo 1 L', categoria: 'Termos', descripcion: '', precioDesdeCentavos: 4_500_000, variosPrecios: true },
    ];

    it('con pocos productos le pasa al modelo la lista entera con precios', async () => {
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'listado', productos: PRODUCTOS, categoria: null, restantes: 0 });
      const llm = crearModelo([llamada('ver_catalogo', {}), new AIMessage('Tengo esto: ...')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo } });

      // A Jev le llega sólo lo que escribió el cliente.
      expect(verCatalogo).toHaveBeenCalledWith('user-1', ['¿tenés mates?'], undefined);
      const [tool] = toolMessages(resultado.messages);
      expect(tool.content).toContain('- "Mate de calabaza": $ 8.000');
      expect(tool.content).toContain('- "Termo 1 L": desde $ 45.000');
      expect(tool.content).toContain('mostrale la lista entera');
    });

    it('con la lista entera, las fotos salen solas con nombre y precio al pie y el texto no las repite', async () => {
      const conFoto = [{ ...PRODUCTOS[0], tieneImagen: true }, PRODUCTOS[1]];
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'listado', productos: conFoto, categoria: null, restantes: 0 });
      const llm = crearModelo([llamada('ver_catalogo', {}), new AIMessage('También tengo el Termo 1 L. ¿Cuál te gusta?')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo } });

      expect(imagenesDeLaVuelta(resultado.messages)).toEqual([
        { productoId: 'p-1', nombre: 'Mate de calabaza', leyenda: 'Mate de calabaza\n$ 8.000' },
      ]);
      const contenido = String(toolMessages(resultado.messages)[0].content);
      expect(contenido).toContain('- "Mate de calabaza": $ 8.000 (ya le llegó en foto)');
      expect(contenido).toContain('nombrale sólo los otros');
      expect(contenido).not.toContain('mostrale la lista entera');
    });

    it('sin la lista entera no manda fotos solas', async () => {
      const conFoto = [{ ...PRODUCTOS[0], tieneImagen: true }];
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'listado', productos: conFoto, categoria: null, restantes: 5 });
      const llm = crearModelo([llamada('ver_catalogo', {}), new AIMessage('.')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo } });

      expect(imagenesDeLaVuelta(resultado.messages)).toEqual([]);
      expect(toolMessages(resultado.messages)[0].content).toContain('mostrale la lista entera');
    });

    it('las fotos del listado no gastan el tope de las que pide el modelo', async () => {
      const PRODUCTOS_CON_FOTO = Array.from({ length: MAX_IMAGENES_POR_MENSAJE + 1 }, (_, i) => ({
        ...PRODUCTOS[0],
        productoId: `p-${i}`,
        nombre: `Mate ${i}`,
        tieneImagen: true,
      }));
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'listado', productos: PRODUCTOS_CON_FOTO, categoria: null, restantes: 0 });
      const imagenes = { estadoDeFoto: vi.fn().mockResolvedValue({ nombre: 'Termo', tieneFoto: true, deVariante: false }) };
      const llm = crearModelo([
        llamada('ver_catalogo', {}),
        llamada('enviar_imagen_producto', { productoId: 'p-termo' }, 'c2'),
        new AIMessage('.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo }, imagenes });

      expect(imagenesDeLaVuelta(resultado.messages)).toHaveLength(MAX_IMAGENES_POR_MENSAJE + 2);
      expect(resultadoDe(resultado.messages, 'enviar_imagen_producto').content).toContain('Listo: la foto');
    });

    it('con muchos le pasa las categorías sugeridas y que hay otras', async () => {
      const verCatalogo = vi.fn().mockResolvedValue({
        tipo: 'categorias',
        categorias: [
          { nombre: 'Termos', cantidad: 4 },
          { nombre: 'Mates', cantidad: 12 },
        ],
        restantes: 3,
        totalProductos: 40,
      });
      const llm = crearModelo([llamada('ver_catalogo', { categoria: '  ' }), new AIMessage('¿Qué te interesa?')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo } });

      // Una categoría vacía es lo mismo que no mandarla.
      expect(verCatalogo).toHaveBeenCalledWith('user-1', ['¿tenés mates?'], undefined);
      const contenido = String(toolMessages(resultado.messages)[0].content);
      expect(contenido).toContain('40 productos con stock');
      expect(contenido.indexOf('"Termos" (4 productos)')).toBeLessThan(contenido.indexOf('"Mates" (12 productos)'));
      expect(contenido).toContain('Hay 3 categorías más');
    });

    it('con una categoría la pasa recortada', async () => {
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'listado', productos: PRODUCTOS.slice(0, 1), categoria: 'Mates', restantes: 0 });
      const llm = crearModelo([llamada('ver_catalogo', { categoria: ' mates ' }), new AIMessage('.')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, sugerencias: { verCatalogo } });

      expect(verCatalogo).toHaveBeenCalledWith('user-1', ['¿tenés mates?'], 'mates');
      expect(toolMessages(resultado.messages)[0].content).toContain('Productos con stock de "Mates"');
    });

    it('un agente creado antes de ver_catalogo la tiene igual, sin regenerarlo', async () => {
      const viejo = { ...AGENT, allowedActions: ACCIONES_VENTAS_IDS.filter((id) => id !== 'ver_catalogo') };
      const verCatalogo = vi.fn().mockResolvedValue({ tipo: 'vacio' });
      const llm = crearModelo([llamada('ver_catalogo', {}), new AIMessage('.')]);

      const resultado = await correr({
        prisma: crearPrisma({ agent: viejo }),
        llm,
        busqueda: { buscar: vi.fn() },
        sugerencias: { verCatalogo },
      });

      const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
      expect(herramientas.map((h) => h.name)).toContain('ver_catalogo');
      expect(verCatalogo).toHaveBeenCalled();
      expect(toolMessages(resultado.messages)[0].content).toContain('no hay ningún producto con stock');
    });

    it('el prompt le dice que use ver_catalogo y le permite la lista sólo ahí', async () => {
      const llm = crearModelo([new AIMessage('Hola.')]);
      await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() } });
      const sistema = sistemaDe(llm);
      expect(sistema).toContain('llamá ver_catalogo en vez de preguntarle qué busca');
      expect(sistema).toContain('Las únicas excepciones son lo que devuelven ver_catalogo y ver_descuentos');
      expect(sistema).not.toContain('preguntá qué busca antes de listar');
    });
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

  describe('enviar_imagen_producto', () => {
    const MATE_CON_FOTO = { ...MATE, tieneImagen: true };
    const conFoto = (estado: { nombre: string; tieneFoto: boolean } | null = { nombre: MATE.nombre, tieneFoto: true }) => ({
      estadoDeFoto: vi.fn().mockResolvedValue(estado),
    });

    it('la búsqueda le dice al modelo el id de producto y si tiene foto', async () => {
      const llm = crearModelo([BUSCAR_MATE, new AIMessage('Tengo el mate.')]);
      const resultado = await correr({
        prisma: crearPrisma(),
        llm,
        busqueda: { buscar: vi.fn().mockResolvedValue([MATE_CON_FOTO]) },
      });
      expect(resultadoDe(resultado.messages, 'buscar_productos').content).toContain(
        '"Mate de calabaza" [producto p-1] (código MATE-01, categoría "Mates", tiene foto)',
      );
    });

    it('aprueba la foto y la deja como artifact para la fachada, sin bytes', async () => {
      const imagenes = conFoto();
      const llm = crearModelo([
        BUSCAR_MATE,
        llamada('enviar_imagen_producto', { productoId: ' p-1 ' }, 'call-foto'),
        new AIMessage('Ahí va. ¿Es lo que buscabas?'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), imagenes });

      expect(imagenes.estadoDeFoto).toHaveBeenCalledWith('user-1', 'p-1', undefined);
      const tool = resultadoDe(resultado.messages, 'enviar_imagen_producto');
      expect(tool.content).toContain('le llega al cliente junto con tu respuesta');
      expect(tool.artifact).toEqual({ productoId: 'p-1', nombre: 'Mate de calabaza' });
      expect(imagenesDeLaVuelta(resultado.messages)).toEqual([{ productoId: 'p-1', nombre: 'Mate de calabaza' }]);
    });

    it('sin foto, o de un producto ajeno, no manda nada y le dice al modelo qué contestar', async () => {
      for (const [estado, texto] of [
        [{ nombre: MATE.nombre, tieneFoto: false }, 'no tiene foto'],
        [null, 'no está en el catálogo'],
      ] as const) {
        const llm = crearModelo([llamada('enviar_imagen_producto', { productoId: 'p-1' }), new AIMessage('.')]);
        const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), imagenes: conFoto(estado) });
        const tool = resultadoDe(resultado.messages, 'enviar_imagen_producto');
        expect(tool.content).toContain(texto);
        expect(tool.artifact).toBeUndefined();
        expect(imagenesDeLaVuelta(resultado.messages)).toEqual([]);
      }
    });

    it(`no manda más de ${MAX_IMAGENES_POR_MENSAJE} fotos por respuesta ni repite una`, async () => {
      const imagenes = { estadoDeFoto: vi.fn(async (_userId: string, id: string) => ({ nombre: `Producto ${id}`, tieneFoto: true })) };
      const llm = crearModelo([
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'f1', name: 'enviar_imagen_producto', args: { productoId: 'p-1' } },
            { id: 'f2', name: 'enviar_imagen_producto', args: { productoId: 'p-1' } },
            { id: 'f3', name: 'enviar_imagen_producto', args: { productoId: 'p-2' } },
          ],
        }),
        // En otra ida y vuelta de la misma respuesta: ya van dos, entra la tercera y no la cuarta.
        llamada('enviar_imagen_producto', { productoId: 'p-3' }, 'f4'),
        llamada('enviar_imagen_producto', { productoId: 'p-4' }, 'f5'),
        new AIMessage('Ahí van.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), imagenes });

      expect(imagenes.estadoDeFoto).toHaveBeenCalledTimes(3);
      expect(imagenesDeLaVuelta(resultado.messages).map((imagen) => imagen.productoId)).toEqual(['p-1', 'p-2', 'p-3']);
      const rechazos = toolMessages(resultado.messages).filter((mensaje) => !mensaje.artifact);
      expect(rechazos.map((mensaje) => mensaje.content)).toEqual([
        expect.stringContaining('ya sale con esta respuesta'),
        expect.stringContaining('que es el máximo'),
      ]);
    });

    it('el tope es por mensaje del cliente: en el siguiente puede mandar otra', async () => {
      const imagenes = conFoto();
      const llm = crearModelo([
        llamada('enviar_imagen_producto', { productoId: 'p-1' }, 'f1'),
        new AIMessage('Ahí va.'),
        llamada('enviar_imagen_producto', { productoId: 'p-1' }, 'f2'),
        new AIMessage('Ahí va de nuevo.'),
      ]);
      const grafo = construirGrafoVentas({
        prisma: crearPrisma(),
        llm,
        busqueda: buscaMate(),
        sugerencias: { verCatalogo: vi.fn(), descuentosVigentes: sinDescuentos() },
        ventas: crearVentas(),
        notificaciones: crearNotificaciones(),
        historico: crearHistorico(),
        imagenes,
        openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
        checkpointer: new MemorySaver(),
      });
      const config = { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION_VENTAS };
      const entrada = (texto: string) => ({
        messages: [new HumanMessage(texto)],
        ownerUserId: 'user-1',
        remoteJid: CONVERSATION.remoteJid,
        esPropietario: false,
      });

      await grafo.invoke(entrada('mandame la foto'), config);
      const segunda = await grafo.invoke(entrada('otra vez'), config);

      // Lo del mensaje anterior no cuenta: la foto vuelve a salir.
      expect(imagenesDeLaVuelta(segunda.messages)).toEqual([{ productoId: 'p-1', nombre: 'Mate de calabaza' }]);
    });

    it('un agente creado antes de las fotos tiene la herramienta igual, sin regenerarlo', async () => {
      const viejo = { ...AGENT, allowedActions: ['buscar_productos', 'crear_pedido'] };
      const llm = crearModelo([new AIMessage('Hola.')]);
      await correr({ prisma: crearPrisma({ agent: viejo }), llm, busqueda: { buscar: vi.fn() } });
      const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
      expect(herramientas.map((h) => h.name)).toContain('enviar_imagen_producto');
    });
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
        BUSCAR_MATE,
        llamada('crear_pedido', { nombreCliente: ' Juan ', items: itemsPedido }),
        new AIMessage('Listo, te paso el link.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma({ mpConectado: true }), llm, busqueda: buscaMate(), ventas });

      expect(ventas.crearPedido).toHaveBeenCalledWith({
        userId: 'user-1',
        conversationId: 'conv-1',
        remoteJid: CONVERSATION.remoteJid,
        nombreCliente: 'Juan',
        // Los renglones repetidos llegan juntos.
        items: [{ varianteId: 'v-1', cantidad: 2 }],
        medioPago: 'mercadopago',
        dePrueba: false,
        // El comercio no pide datos: no hay entrega ni datos que guardar.
        entrega: null,
        datosCliente: [],
      });
      const tool = resultadoDe(resultado.messages, 'crear_pedido');
      expect(tool.content).toContain('Pedido creado para "Juan": 2 × Mate de calabaza ($ 16.000). Total $ 16.000.');
      expect(tool.content).toContain('https://mp/pagar/venta-1');
      expect(sistemaDe(llm)).toContain('Cobro: con link de pago de Mercado Pago');
    });

    describe('datos del cliente', () => {
      const CON_ENVIOS = {
        ...AGENT,
        haceEnvios: true,
        // Con retiro en el local, el cliente elige entre envío y retiro.
        local: { tieneLocal: true, horarios: [], retiroEnLocal: true },
        datosCliente: [
          { tipo: 'codigoPostal', obligatorio: true },
          { tipo: 'personalizado', etiqueta: 'Entre calles', obligatorio: false },
        ],
      };

      it('las reglas le dicen qué pedir, y sin elegir envío o retiro no crea el pedido', async () => {
        const ventas = crearVentas();
        const llm = crearModelo([
          BUSCAR_MATE,
          llamada('crear_pedido', { nombreCliente: 'Juan', items: itemsPedido }),
          new AIMessage('¿Lo querés con envío o lo retirás?'),
        ]);

        const resultado = await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), ventas });

        expect(ventas.crearPedido).not.toHaveBeenCalled();
        expect(toolMessages(resultado.messages)[1].content).toContain('si lo quiere con envío o si lo retira');
        const sistema = sistemaDe(llm);
        expect(sistema).toContain('Hacemos envíos');
        expect(sistema).toContain('"Código postal" (obligatorio), "Entre calles" (opcional)');
      });

      describe('Jev decide si ya es momento de pedir los datos', () => {
        // Con la marca de llegada: sin ella quedarían fuera de la ventana de historial.
        const charla = [
          conMarcaDeLlegada(new HumanMessage('quiero una mesa a medida'), new Date()),
          new AIMessage('¡Dale! ¿De qué largo la necesitás?'),
          new HumanMessage('1,80'),
        ];

        it('mientras sigue definiendo, las reglas no le piden datos', async () => {
          const decisiones = { configurado: true, ordenar: vi.fn().mockResolvedValue(['defining', 'ready']) };
          const llm = crearModelo([new AIMessage('¿Y en qué color?')]);

          await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), decisiones }, false, charla);

          const [pedido] = decisiones.ordenar.mock.calls[0] as [{ estado: string }];
          expect(pedido.estado).toContain('Shop: ¡Dale! ¿De qué largo la necesitás?');
          expect(pedido.estado).toContain('Customer: 1,80');
          expect(sistemaDe(llm)).toContain('no le pidas datos de contacto ni de envío');
          expect(sistemaDe(llm)).not.toContain('"Código postal" (obligatorio)');
        });

        it('cuando ya eligió todo, pide los datos', async () => {
          const decisiones = { configurado: true, ordenar: vi.fn().mockResolvedValue(['ready', 'defining']) };
          const llm = crearModelo([new AIMessage('¿Lo querés con envío o lo retirás?')]);

          await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), decisiones }, false, charla);

          expect(sistemaDe(llm)).toContain('El cliente ya eligió todo');
          expect(sistemaDe(llm)).toContain('"Código postal" (obligatorio)');
        });

        it('si Jev falla queda la regla de siempre, y si el comercio no pide datos ni lo consulta', async () => {
          const falla = { configurado: true, ordenar: vi.fn().mockRejectedValue(new Error('timeout')) };
          const llm = crearModelo([new AIMessage('¿En qué color?')]);
          await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), decisiones: falla }, false, charla);
          expect(sistemaDe(llm)).toContain('te dijo que no quiere nada más (nunca antes)');

          const sinDatos = { configurado: true, ordenar: vi.fn() };
          await correr({ prisma: crearPrisma(), llm: crearModelo([new AIMessage('Dale')]), busqueda: buscaMate(), decisiones: sinDatos }, false, charla);
          expect(sinDatos.ordenar).not.toHaveBeenCalled();
        });
      });

      it('con envío exige los obligatorios y guarda lo que contestó con la etiqueta del comercio', async () => {
        const ventas = crearVentas();
        ventas.crearPedido.mockResolvedValue({ ...VENTA, entrega: 'envio' });
        const llm = crearModelo([
          BUSCAR_MATE,
          llamada('crear_pedido', { nombreCliente: 'Juan', items: itemsPedido, entrega: 'envio', datosCliente: [] }),
          llamada('crear_pedido', {
            nombreCliente: 'Juan',
            items: itemsPedido,
            entrega: 'envio',
            datosCliente: [
              { campo: 'codigo postal', valor: ' C1414 ' },
              { campo: 'Entre calles', valor: 'Thames y Uriarte' },
              // Lo que el comercio no pidió no se guarda.
              { campo: 'Tarjeta', valor: '4111' },
            ],
          }),
          new AIMessage('Listo.'),
        ]);

        const resultado = await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), ventas });

        const [, rechazo, creado] = toolMessages(resultado.messages);
        expect(rechazo.content).toContain('faltan "Código postal"');
        expect(ventas.crearPedido).toHaveBeenCalledTimes(1);
        expect(ventas.crearPedido).toHaveBeenCalledWith(
          expect.objectContaining({
            entrega: 'envio',
            datosCliente: [
              { etiqueta: 'Código postal', valor: 'C1414' },
              { etiqueta: 'Entre calles', valor: 'Thames y Uriarte' },
            ],
          }),
        );
        expect(creado.content).toContain('Es con envío');
      });

      it('si lo retira no le pide los datos de envío', async () => {
        const ventas = crearVentas();
        ventas.crearPedido.mockResolvedValue(VENTA);
        const llm = crearModelo([
          BUSCAR_MATE,
          llamada('crear_pedido', { nombreCliente: 'Juan', items: itemsPedido, entrega: 'retiro' }),
          new AIMessage('Listo.'),
        ]);

        await correr({ prisma: crearPrisma({ agent: CON_ENVIOS }), llm, busqueda: buscaMate(), ventas });

        expect(ventas.crearPedido).toHaveBeenCalledWith(expect.objectContaining({ entrega: 'retiro', datosCliente: [] }));
      });
    });

    it('sin Mercado Pago el pedido queda para coordinar, y desde el banco de pruebas va marcado', async () => {
      const ventas = crearVentas();
      ventas.crearPedido.mockResolvedValue({ ...VENTA, linkPago: null, medioPago: 'manual' });
      const llm = crearModelo([
        BUSCAR_MATE,
        llamada('crear_pedido', { nombreCliente: 'Juan', items: [{ varianteId: 'v-1', cantidad: 2 }] }),
        new AIMessage('Anotado.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate(), ventas }, true);

      expect(ventas.crearPedido).toHaveBeenCalledWith(expect.objectContaining({ medioPago: 'manual', dePrueba: true }));
      expect(resultadoDe(resultado.messages, 'crear_pedido').content).toContain('le escribimos por este chat para coordinar el pago');
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
        llm: crearModelo([BUSCAR_MATE, llamada('crear_pedido', { nombreCliente: 'Juan', items: itemsPedido }), new AIMessage('Perdón.')]),
        busqueda: buscaMate(),
        ventas,
      });
      expect(resultadoDe(resultado.messages, 'crear_pedido').content).toBe(
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

  describe('con productos a medida: pedidos a medida (LAU-27)', () => {
    const A_PEDIDO = AGENT;
    const PLACARD: ProductoEncontrado = {
      productoId: 'p-placard',
      codigo: 'PLACARD',
      nombre: 'Placard',
      categoria: null,
      descripcion: 'A medida',
      tieneImagen: false,
      variantes: [],
      aMedida: true,
      precioReferenciaCentavos: null,
      materiales: [],
      preguntas: [{ texto: 'Ancho (cm)', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true }],
    } as unknown as ProductoEncontrado;
    const BUSCAR_PLACARD = llamada('buscar_productos', { consulta: 'placard' }, 'call-busqueda');
    const SOLICITUD = { preguntas: [{ texto: 'Ancho (cm)', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true }] };
    const PEDIDO = {
      id: 'v-1',
      tipo: 'a_medida',
      estado: 'a_cotizar',
      atencion: 'asistente',
      totalCentavos: null,
      reservaVenceAt: null,
      linkPago: null,
      createdAt: new Date('2026-10-15T10:00:00-03:00'),
      solicitud: { productoId: 'p-placard', nombreProducto: 'Placard', respuestas: [], resumen: '' },
      items: [],
      presupuestos: [],
    };

    it('las herramientas de pedidos a medida se suman a las de stock', async () => {
      const llm = crearModelo([new AIMessage('Hola.')]);
      await correr({ prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }), llm, busqueda: { buscar: vi.fn() } });
      const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
      const nombres = herramientas.map((h) => h.name);
      expect(nombres).toEqual(expect.arrayContaining(['registrar_solicitud', 'aceptar_presupuesto', 'derivar_a_persona']));
      expect(nombres).toContain('crear_pedido');
    });

    describe('versiones con precio fijo', () => {
      const versión = (varianteId: string, nombre: string, precioCentavos: number, tieneImagen = false) => ({
        varianteId,
        sku: varianteId,
        nombre,
        precioCentavos,
        precioFinalCentavos: precioCentavos,
        descuento: null,
        hayStock: true,
        stock: 'disponible',
        unidades: null,
        reservadas: 0,
        stockMinimo: null,
        tieneImagen,
      });
      const MESA = {
        ...PLACARD,
        productoId: 'p-mesa',
        codigo: 'MESA',
        nombre: 'Mesa ratona',
        tieneImagen: true,
        preguntas: [],
        variantes: [versión('v-roble', 'Roble 1,20 m', 18_000_000, true), versión('v-pino', 'Pino 1,00 m', 12_000_000)],
      } as unknown as ProductoEncontrado;
      const BUSCAR_MESA = llamada('buscar_productos', { consulta: 'mesa' }, 'call-busqueda');
      const buscaMesa = () => ({ buscar: vi.fn().mockResolvedValue([MESA]) });
      const PEDIDO_VARIANTE = {
        ...PEDIDO,
        id: 'v-9',
        estado: 'pendiente_pago',
        totalCentavos: 36_000_000,
        linkPago: 'https://mp/pagar/v-9',
        reservaVenceAt: new Date('2099-01-01T15:30:00-03:00'),
        solicitud: {
          productoId: 'p-mesa',
          nombreProducto: 'Mesa ratona',
          respuestas: [],
          resumen: '',
          variante: { id: 'v-roble', nombre: 'Roble 1,20 m', precioCentavos: 18_000_000, cantidad: 2 },
          cambios: null,
        },
        items: [{ nombreProducto: 'Mesa ratona', nombreVariante: 'Roble 1,20 m', cantidad: 2, subtotalCentavos: 36_000_000 }],
      };

      it('la búsqueda trae las versiones con su id y el modelo tiene pedir_variante', async () => {
        const llm = crearModelo([BUSCAR_MESA, new AIMessage('Tenemos dos versiones.')]);
        const resultado = await correr({ prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }), llm, busqueda: buscaMesa() });
        const [herramientas] = llm.bindTools.mock.calls[0] as unknown as [Array<{ name: string }>];
        expect(herramientas.map((h) => h.name)).toContain('pedir_variante');
        expect(resultadoDe(resultado.messages, 'buscar_productos').content).toContain(
          '"Roble 1,20 m" [variante v-roble]: $ 180.000, precio fijo, tiene foto',
        );
      });

      it('tal cual: pedir_variante anota el pedido con su precio y le pasa el link al modelo', async () => {
        const pedidos = crearPedidosAMedida();
        pedidos.pedirVariante.mockResolvedValue(PEDIDO_VARIANTE);
        const resultado = await correr({
          prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO, mpConectado: true }),
          llm: crearModelo([
            BUSCAR_MESA,
            llamada('pedir_variante', { varianteId: 'v-inventada', cantidad: 2, nombreCliente: 'Ana' }, 'c2'),
            llamada('pedir_variante', { varianteId: ' v-roble ', cantidad: 2, nombreCliente: 'Ana' }, 'c3'),
            new AIMessage('Listo Ana, te paso el link: https://mp/pagar/v-9'),
          ]),
          busqueda: buscaMesa(),
          pedidos,
        });

        const [inventada, anotada] = toolMessages(resultado.messages).filter((m) => m.name === 'pedir_variante');
        expect(inventada.content).toContain('no salió de ninguna búsqueda');
        expect(pedidos.pedirVariante).toHaveBeenCalledOnce();
        expect(pedidos.pedirVariante.mock.calls[0][0]).toMatchObject({
          varianteId: 'v-roble',
          cantidad: 2,
          nombreCliente: 'Ana',
          dePrueba: false,
        });
        expect(anotada.content).toContain('Pedido anotado [pedido v-9]');
        // Sin datos configurados no se pide nada.
        expect(pedidos.pedirVariante.mock.calls[0][0]).toMatchObject({ entrega: null, datosCliente: [] });
        expect(anotada.content).toContain('total $ 360.000, el precio fijo de esa versión');
        expect(anotada.content).toContain('https://mp/pagar/v-9');
      });

      it('tal cual y con envíos: pedir_variante no sale sin los datos obligatorios', async () => {
        const conEnvios = { ...A_PEDIDO, haceEnvios: true, datosCliente: [{ tipo: 'direccion', obligatorio: true }] };
        const pedidos = crearPedidosAMedida();
        pedidos.pedirVariante.mockResolvedValue(PEDIDO_VARIANTE);
        const resultado = await correr({
          prisma: crearPrisma({ productosAMedida: 1, agent: conEnvios, mpConectado: true }),
          llm: crearModelo([
            BUSCAR_MESA,
            llamada('pedir_variante', { varianteId: 'v-roble', cantidad: 1, nombreCliente: 'Ana' }, 'c2'),
            llamada(
              'pedir_variante',
              { varianteId: 'v-roble', cantidad: 1, nombreCliente: 'Ana', datosCliente: [{ campo: 'Dirección', valor: 'Corrientes 1234' }] },
              'c3',
            ),
            new AIMessage('Listo Ana.'),
          ]),
          busqueda: buscaMesa(),
          pedidos,
        });

        const [sinDatos] = toolMessages(resultado.messages).filter((m) => m.name === 'pedir_variante');
        expect(sinDatos.content).toContain('faltan "Dirección"');
        expect(sinDatos.content).toContain('volvé a llamar pedir_variante');
        expect(pedidos.pedirVariante).toHaveBeenCalledOnce();
        expect(pedidos.pedirVariante.mock.calls[0][0]).toMatchObject({
          entrega: 'envio',
          datosCliente: [{ etiqueta: 'Dirección', valor: 'Corrientes 1234' }],
        });
      });

      it('con cambios: registrar_solicitud lleva la versión de base y lo que cambia', async () => {
        const pedidos = crearPedidosAMedida();
        pedidos.productoParaSolicitud.mockResolvedValue({ id: 'p-mesa', nombre: 'Mesa ratona', solicitud: { preguntas: [] } });
        pedidos.varianteParaPedir.mockImplementation(async (_userId: string, id: string) =>
          id === 'v-roble'
            ? { productoId: 'p-mesa', nombreProducto: 'Mesa ratona', varianteId: 'v-roble', nombreVariante: 'Roble 1,20 m', precioCentavos: 18_000_000 }
            : { productoId: 'p-otro', nombreProducto: 'Otro', varianteId: id, nombreVariante: 'Otra', precioCentavos: 1 },
        );
        pedidos.registrarSolicitud.mockResolvedValue({ venta: PEDIDO, nueva: true, cambio: true });
        const base = { productoId: 'p-mesa', nombreCliente: 'Ana', respuestas: [], resumen: 'Mesa más larga' };
        const resultado = await correr({
          prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }),
          llm: crearModelo([
            BUSCAR_MESA,
            llamada('registrar_solicitud', { ...base, varianteBaseId: 'v-roble' }, 'c2'),
            llamada('registrar_solicitud', { ...base, varianteBaseId: 'v-pino', cambios: 'de 1,50 m' }, 'c3'),
            llamada('registrar_solicitud', { ...base, varianteBaseId: 'v-roble', cambios: ' de 1,50 m de largo ' }, 'c4'),
            new AIMessage('Te la cotizamos.'),
          ]),
          busqueda: buscaMesa(),
          pedidos,
        });

        const [sinCambios, deOtro, anotada] = toolMessages(resultado.messages).filter((m) => m.name === 'registrar_solicitud');
        expect(sinCambios.content).toContain('usá pedir_variante');
        expect(deOtro.content).toContain('no es de este producto');
        expect(anotada.content).toContain('Solicitud anotada');
        expect(pedidos.registrarSolicitud).toHaveBeenCalledOnce();
        expect(pedidos.registrarSolicitud.mock.calls[0][0]).toMatchObject({
          variante: { id: 'v-roble', nombre: 'Roble 1,20 m', precioCentavos: 18_000_000, cantidad: 1 },
          cambios: 'de 1,50 m de largo',
        });
      });

      it('la foto de la versión va con su id; sin foto propia va la del producto, y no se repite', async () => {
        const imagenes = {
          estadoDeFoto: vi.fn(async (_userId: string, _id: string, varianteId?: string) =>
            varianteId === 'v-roble'
              ? { nombre: 'Mesa ratona · Roble 1,20 m', tieneFoto: true, deVariante: true }
              : { nombre: 'Mesa ratona', tieneFoto: true, deVariante: false },
          ),
        };
        const llm = crearModelo([
          BUSCAR_MESA,
          new AIMessage({
            content: '',
            tool_calls: [
              { id: 'f1', name: 'enviar_imagen_producto', args: { productoId: 'p-mesa' } },
              { id: 'f2', name: 'enviar_imagen_producto', args: { productoId: 'p-mesa', varianteId: 'v-roble' } },
            ],
          }),
          llamada('enviar_imagen_producto', { productoId: 'p-mesa', varianteId: 'v-pino' }, 'f3'),
          new AIMessage('Mirá.'),
        ]);
        const resultado = await correr({ prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }), llm, busqueda: buscaMesa(), imagenes });

        expect(imagenesDeLaVuelta(resultado.messages)).toEqual([
          { productoId: 'p-mesa', nombre: 'Mesa ratona' },
          { productoId: 'p-mesa', nombre: 'Mesa ratona · Roble 1,20 m', varianteId: 'v-roble' },
        ]);
        // El pino no tiene foto propia y la del producto ya salió: no se repite.
        expect(resultadoDe(resultado.messages, 'enviar_imagen_producto').content).toContain('no tiene foto propia');
      });
    });

    it('registrar_solicitud valida contra las preguntas del producto y anota el pedido', async () => {
      const pedidos = crearPedidosAMedida();
      pedidos.productoParaSolicitud.mockResolvedValue({ id: 'p-placard', nombre: 'Placard', solicitud: SOLICITUD });
      pedidos.registrarSolicitud.mockResolvedValue({ venta: PEDIDO, nueva: true, cambio: true });
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }),
        llm: crearModelo([
          BUSCAR_PLACARD,
          llamada('registrar_solicitud', { productoId: 'p-placard', nombreCliente: 'Ana', respuestas: [], resumen: 'Un placard' }, 'c2'),
          llamada(
            'registrar_solicitud',
            { productoId: 'p-placard', nombreCliente: 'Ana', respuestas: [{ pregunta: 'ancho (cm)', respuesta: '120' }], resumen: 'Un placard' },
            'c3',
          ),
          new AIMessage('Listo, te lo cotizamos.'),
        ]),
        busqueda: { buscar: vi.fn().mockResolvedValue([PLACARD]) },
        pedidos,
      });

      const [incompleta, anotada] = toolMessages(resultado.messages).filter((m) => m.name === 'registrar_solicitud');
      expect(incompleta.content).toContain('La solicitud todavía no está completa: faltan "Ancho (cm)"');
      expect(anotada.content).toContain('Solicitud anotada [pedido v-1]');
      expect(pedidos.registrarSolicitud).toHaveBeenCalledOnce();
      expect(pedidos.registrarSolicitud.mock.calls[0][0]).toMatchObject({
        producto: { id: 'p-placard', nombre: 'Placard' },
        respuestas: [{ pregunta: 'Ancho (cm)', respuesta: '120' }],
        nombreCliente: 'Ana',
        dePrueba: false,
      });
      expect(pedidos.cotizarSolicitud).toHaveBeenCalledOnce();
    });

    it('si la receta necesita un número que el cliente no dio, se lo pregunta antes de anotar', async () => {
      const pedidos = crearPedidosAMedida();
      pedidos.productoParaSolicitud.mockResolvedValue({ id: 'p-placard', nombre: 'Placard', solicitud: { preguntas: [] } });
      pedidos.cotizacionPrevia.mockResolvedValue({
        politica: 'automatica',
        resultado: { ok: false, motivo: 'falta', faltan: ['Alto (cm)'] },
      });
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }),
        llm: crearModelo([
          BUSCAR_PLACARD,
          llamada('registrar_solicitud', { productoId: 'p-placard', nombreCliente: 'Ana', respuestas: [], resumen: '' }, 'c2'),
          new AIMessage('¿Y de alto?'),
        ]),
        busqueda: { buscar: vi.fn().mockResolvedValue([PLACARD]) },
        pedidos,
      });
      expect(resultadoDe(resultado.messages, 'registrar_solicitud').content).toContain('"Alto (cm)" con un número');
      expect(pedidos.registrarSolicitud).not.toHaveBeenCalled();
    });

    it('con cotización automática le pasa el presupuesto tal cual, y el monto pasa la verificación', async () => {
      const pedidos = crearPedidosAMedida();
      pedidos.productoParaSolicitud.mockResolvedValue({ id: 'p-placard', nombre: 'Placard', solicitud: { preguntas: [] } });
      pedidos.registrarSolicitud.mockResolvedValue({ venta: PEDIDO, nueva: true, cambio: true });
      pedidos.cotizarSolicitud.mockResolvedValue({ modo: 'automatica', texto: '*Presupuesto de Placard*\n*Total: $ 67.500*' });
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }),
        llm: crearModelo([
          BUSCAR_PLACARD,
          llamada('registrar_solicitud', { productoId: 'p-placard', nombreCliente: 'Ana', respuestas: [], resumen: '' }, 'c2'),
          new AIMessage('*Presupuesto de Placard*\n*Total: $ 67.500*\n\n¿Querés que avancemos?'),
        ]),
        busqueda: { buscar: vi.fn().mockResolvedValue([PLACARD]) },
        pedidos,
      });
      expect(resultadoDe(resultado.messages, 'registrar_solicitud').content).toContain('Total: $ 67.500');
      expect(resultado.messages.at(-1)?.content).toContain('$ 67.500');
    });

    it('un producto que no salió de una búsqueda no se anota', async () => {
      const pedidos = crearPedidosAMedida();
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO }),
        llm: crearModelo([
          llamada('registrar_solicitud', { productoId: 'p-inventado', nombreCliente: 'Ana', respuestas: [], resumen: '' }),
          new AIMessage('.'),
        ]),
        busqueda: { buscar: vi.fn() },
        pedidos,
      });
      expect(resultadoDe(resultado.messages, 'registrar_solicitud').content).toContain('no salió de ninguna búsqueda');
      expect(pedidos.productoParaSolicitud).not.toHaveBeenCalled();
    });

    it('aceptar_presupuesto sólo cobra un pedido de la charla con presupuesto mandado', async () => {
      const cotizado = {
        ...PEDIDO,
        estado: 'cotizado',
        totalCentavos: 5_900_000,
        presupuestos: [{ id: 'pr-1', estado: 'enviado', version: 1, estimativo: false }],
      };
      const pedidos = crearPedidosAMedida();
      pedidos.cobrar.mockResolvedValue({ ...cotizado, estado: 'pendiente_pago', linkPago: 'https://mp/pagar/v-1', reservaVenceAt: null });
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO, pedidosAMedida: [cotizado, { ...PEDIDO, id: 'v-2' }] }),
        llm: crearModelo([
          llamada('aceptar_presupuesto', { pedidoId: 'v-ajeno' }, 'c1'),
          llamada('aceptar_presupuesto', { pedidoId: 'v-2' }, 'c2'),
          llamada('aceptar_presupuesto', { pedidoId: 'v-1' }, 'c3'),
          new AIMessage('Te paso el link.'),
        ]),
        busqueda: { buscar: vi.fn() },
        pedidos,
      });
      const [ajeno, sinPresupuesto, cobrado] = toolMessages(resultado.messages).filter((m) => m.name === 'aceptar_presupuesto');
      expect(ajeno.content).toContain('no es de esta conversación');
      expect(sinPresupuesto.content).toContain('todavía no tiene un presupuesto');
      expect(cobrado.content).toContain('https://mp/pagar/v-1');
      expect(pedidos.cobrar).toHaveBeenCalledWith('user-1', 'v-1', {
        autor: 'asistente',
        conversationId: CONVERSATION.id,
        entrega: null,
        datosCliente: [],
      });
    });

    it('si el negocio hace envíos, aceptar_presupuesto pide los datos obligatorios y los guarda', async () => {
      const conEnvios = { ...A_PEDIDO, haceEnvios: true, datosCliente: [{ tipo: 'codigoPostal', obligatorio: true }] };
      const cotizado = {
        ...PEDIDO,
        estado: 'cotizado',
        totalCentavos: 5_900_000,
        presupuestos: [{ id: 'pr-1', estado: 'enviado', version: 1, estimativo: false }],
      };
      const pedidos = crearPedidosAMedida();
      pedidos.cobrar.mockResolvedValue({ ...cotizado, estado: 'pendiente_pago', linkPago: 'https://mp/pagar/v-1', reservaVenceAt: null });
      const llm = crearModelo([
        llamada('aceptar_presupuesto', { pedidoId: 'v-1' }, 'c1'),
        llamada('aceptar_presupuesto', { pedidoId: 'v-1', datosCliente: [{ campo: 'Código postal', valor: '1414' }] }, 'c2'),
        new AIMessage('Te paso el link.'),
      ]);
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: conEnvios, pedidosAMedida: [cotizado] }),
        llm,
        busqueda: { buscar: vi.fn() },
        pedidos,
      });

      // Las reglas nombran también los cierres a medida.
      expect(sistemaDe(llm)).toContain('crear_pedido, pedir_variante o aceptar_presupuesto');
      const [sinDatos] = toolMessages(resultado.messages).filter((m) => m.name === 'aceptar_presupuesto');
      expect(sinDatos.content).toContain('faltan "Código postal"');
      expect(sinDatos.content).toContain('volvé a llamar aceptar_presupuesto');
      expect(pedidos.cobrar).toHaveBeenCalledOnce();
      expect(pedidos.cobrar).toHaveBeenCalledWith('user-1', 'v-1', {
        autor: 'asistente',
        conversationId: CONVERSATION.id,
        entrega: 'envio',
        datosCliente: [{ etiqueta: 'Código postal', valor: '1414' }],
      });
    });

    it('derivar_a_persona pasa el chat a una persona y no promete plazos', async () => {
      const pedidos = crearPedidosAMedida();
      pedidos.derivar.mockResolvedValue(PEDIDO);
      const resultado = await correr({
        prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO, pedidosAMedida: [PEDIDO] }),
        llm: crearModelo([
          llamada('derivar_a_persona', { pedidoId: 'v-1', motivo: 'pide_persona', detalle: 'Quiere hablar con alguien' }),
          new AIMessage('Ya te escribe alguien del equipo por acá.'),
        ]),
        busqueda: { buscar: vi.fn() },
        pedidos,
      });
      expect(pedidos.derivar.mock.calls[0][0]).toMatchObject({
        ventaId: 'v-1',
        motivo: 'pide_persona',
        detalle: 'Quiere hablar con alguien',
        autor: 'asistente',
      });
      expect(resultadoDe(resultado.messages, 'derivar_a_persona').content).toContain('No prometas cuándo');
    });

    it('el prompt trae los pedidos a medida de la charla con su id', async () => {
      const llm = crearModelo([new AIMessage('Hola.')]);
      await correr({ prisma: crearPrisma({ productosAMedida: 1, agent: A_PEDIDO, pedidosAMedida: [PEDIDO] }), llm, busqueda: { buscar: vi.fn() } });
      expect(sistemaDe(llm)).toContain('[pedido v-1] "Placard"');
      expect(sistemaDe(llm)).toContain('derivar_a_persona');
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

  describe('no inventa precios ni productos', () => {
    it('una respuesta con un precio que no salió del catálogo se descarta y el modelo la corrige', async () => {
      const prisma = crearPrisma();
      const busqueda = { buscar: vi.fn().mockResolvedValue([]) };
      const llm = crearModelo([
        new AIMessage('¡Sí! El termo está $ 25.000.'),
        llamada('buscar_productos', { consulta: 'termo' }, 'call-termo'),
        new AIMessage('No tengo termos. ¿Buscás otra cosa?'),
      ]);

      const resultado = await correr({ prisma, llm, busqueda });

      expect(resultado.messages.at(-1)?.content).toBe('No tengo termos. ¿Buscás otra cosa?');
      expect(resultado.messages.some((mensaje) => String(mensaje.content).includes('$ 25.000'))).toBe(false);
      // La segunda llamada al modelo lleva la corrección en el prompt.
      const [segunda] = llm.invoke.mock.calls[1] as unknown as [BaseMessage[]];
      expect(String(segunda[0].content)).toContain('Corrección: tu respuesta anterior mencionaba $ 25.000');
      // La respuesta inventada no llega a la tabla Message.
      const guardados = (prisma.message.create as ReturnType<typeof vi.fn>).mock.calls.map(([{ data }]) => JSON.stringify(data));
      expect(guardados.some((fila) => fila.includes('25.000'))).toBe(false);
    });

    it('si insiste con un precio inventado, contesta una pregunta fija en vez de mandarlo', async () => {
      const llm = crearModelo([new AIMessage('El termo está $ 25.000.'), new AIMessage('Sale $ 25.000, te lo guardo.')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() } });

      expect(resultado.messages.at(-1)?.content).toBe(MENSAJE_PRECIO_SIN_VERIFICAR);
      expect(llm.invoke).toHaveBeenCalledTimes(2);
    });

    it('un precio que sí devolvió la búsqueda pasa sin tocar', async () => {
      const llm = crearModelo([BUSCAR_MATE, new AIMessage('Tengo el mate de calabaza a $ 8.000; los 2 te quedan $ 16.000.')]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: buscaMate() });

      expect(resultado.messages.at(-1)?.content).toContain('$ 16.000');
      expect(llm.invoke).toHaveBeenCalledTimes(2);
    });

    it('no deja buscar más de 3 veces por mensaje: a la cuarta le dice que no lo tiene', async () => {
      const busqueda = { buscar: vi.fn().mockResolvedValue([]) };
      const llm = crearModelo([
        llamada('buscar_productos', { consulta: 'termo' }, 'b1'),
        llamada('buscar_productos', { consulta: 'termo acero' }, 'b2'),
        llamada('buscar_productos', { consulta: 'termolar' }, 'b3'),
        llamada('buscar_productos', { consulta: 'botella térmica' }, 'b4'),
        new AIMessage('No tengo termos, perdón.'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda });

      expect(busqueda.buscar).toHaveBeenCalledTimes(3);
      expect(resultadoDe(resultado.messages, 'buscar_productos').content).toContain('Ya buscaste 3 veces');
      expect(resultado.messages.at(-1)?.content).toBe('No tengo termos, perdón.');
    });

    it('crear_pedido con una variante que no salió de ninguna búsqueda no llega a crear nada', async () => {
      const ventas = crearVentas();
      const llm = crearModelo([
        llamada('crear_pedido', { nombreCliente: 'Juan', items: [{ varianteId: 'v-inventada', cantidad: 1 }] }),
        new AIMessage('Perdón, ¿qué producto querías?'),
      ]);

      const resultado = await correr({ prisma: crearPrisma(), llm, busqueda: { buscar: vi.fn() }, ventas });

      expect(resultadoDe(resultado.messages, 'crear_pedido').content).toContain('no salieron de ninguna búsqueda');
      expect(ventas.crearPedido).not.toHaveBeenCalled();
    });
  });
});

