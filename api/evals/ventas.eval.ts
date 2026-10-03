/**
 * Eval del asistente de ventas contra OpenRouter real: el grafo de ventas
 * completo por la misma puerta que WhatsApp (`ConversationService`), con la
 * búsqueda híbrida de verdad (Postgres + pgvector + embeddings reales) y un
 * catálogo de prueba. Como el de agenda, los checks miran el estado final
 * (pedidos y reservas en la base), no cómo redacta cada modelo; lo único que se
 * lee del texto son los precios, que tienen que salir todos del catálogo.
 *
 * Necesita OPENROUTER_API_KEY y TEST_DATABASE_URL (una base migrada con
 * pgvector, la misma de los *.db.spec.ts). Cuesta plata: no corre con npm test.
 *
 *   TEST_DATABASE_URL=… EVAL_MODELOS=google/gemma-4-31b-it npm run eval -- ventas
 */
import 'dotenv/config';
import 'reflect-metadata';
import { MemorySaver } from '@langchain/langgraph';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentsService } from '../src/agents/agents.service.js';
import type { OpenRouterClient } from '../src/agents/openrouter.client.js';
import { BusquedaService } from '../src/comercio/busqueda.service.js';
import { CuentaMercadoPagoService } from '../src/comercio/cuenta-mercadopago.service.js';
import { DecisionesClient } from '../src/comercio/decisiones.client.js';
import { EmbeddingsClient } from '../src/comercio/embeddings.client.js';
import { HistoricoVentasService } from '../src/comercio/historico.service.js';
import { IndexadorService } from '../src/comercio/indexador.service.js';
import { ProductosService } from '../src/comercio/productos.service.js';
import { SugerenciasService } from '../src/comercio/sugerencias.service.js';
import { VentasService } from '../src/comercio/ventas.service.js';
import { OPENROUTER_BASE_URL_POR_DEFECTO, OPENROUTER_DECISIONS_URL_POR_DEFECTO, type Env } from '../src/config/env.js';
import { ConversationService } from '../src/conversation/conversation.service.js';
import type { GrafoConversacion } from '../src/conversation/graph/graph.factory.js';
import { llmProvider } from '../src/conversation/llm.provider.js';
import { construirGrafoVentas, type GrafoVentas } from '../src/conversation/ventas/grafo-ventas.factory.js';
import type { ItemVenta, User, Venta } from '../src/generated/prisma/client.js';
import { NotificacionesService } from '../src/notificaciones/notificaciones.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { MercadoPagoClient } from '../src/subscription/mercadopago.client.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../test/base-de-prueba.js';
import { contarToolCallsNuevas } from './adversarial/medicion.js';
import { HAY_CLAVE, modelosDelEval } from './modelos.js';
import { guardarReporte, normalizar, type Resultado } from './reporte.js';

const CATALOGO = [
  { codigo: 'MATE-CAL', nombre: 'Mate de calabaza', descripcion: 'Curado a mano, con virola de alpaca.', categoria: 'Mates', precio: 18_500, stock: 50 },
  { codigo: 'MATE-IMP', nombre: 'Mate imperial', descripcion: 'Calabaza forrada en cuero con virola cincelada.', categoria: 'Mates', precio: 62_000, stock: 0 },
  { codigo: 'MATE-VID', nombre: 'Mate de vidrio', descripcion: 'Vidrio templado con funda de silicona.', categoria: 'Mates', precio: 9_900, stock: 50 },
  { codigo: 'TERMO-1L', nombre: 'Termo de acero 1 litro', descripcion: 'Acero inoxidable, pico cebador, mantiene 24 h.', categoria: 'Termos', precio: 45_000, stock: 50 },
  { codigo: 'TERMO-500', nombre: 'Termo de acero 500 ml', descripcion: 'Chico, para llevar en la mochila.', categoria: 'Termos', precio: 32_000, stock: 50 },
  { codigo: 'BOMB-ALP', nombre: 'Bombilla de alpaca', descripcion: 'Pico curvo, filtro de resorte.', categoria: 'Bombillas', precio: 12_000, stock: 50 },
  { codigo: 'BOMB-ACE', nombre: 'Bombilla de acero', descripcion: 'Recta, desarmable para limpiar.', categoria: 'Bombillas', precio: 6_500, stock: 50 },
  { codigo: 'YERBA-1K', nombre: 'Yerba orgánica 1 kg', descripcion: 'Molienda tradicional con palo, suave.', categoria: 'Yerbas', precio: 6_500, stock: 50 },
  { codigo: 'SET-REG', nombre: 'Set matero de regalo', descripcion: 'Mate, bombilla y yerbera en estuche de cuero.', categoria: 'Regalos', precio: 98_000, stock: 50 },
] as const;

/** "$ 45.000", "$45000" o "$ 16.000,50" → centavos. */
function montosEn(texto: string): number[] {
  return [...texto.matchAll(/\$\s?(\d[\d.]*)(?:,(\d{1,2}))?/g)].map(
    ([, enteros, decimales]) => Number(enteros.replace(/\./g, '')) * 100 + Number((decimales ?? '0').padEnd(2, '0')),
  );
}

type VentaConItems = Venta & { items: ItemVenta[] };

type Caso = {
  id: string;
  mensajes: string[];
  check: (ventas: VentaConItems[], respuestas: string[], herramientas: string[]) => Record<string, boolean>;
};

/** La respuesta a "¿querés algo más antes de que te pase el link?": ya no se confirma el pedido. */
const NADA_MAS = 'no, nada más';

const sinPedidos = (ventas: VentaConItems[]) => ventas.length === 0;
const unidadesDe = (venta: VentaConItems | undefined, codigo: string) =>
  venta?.items.filter((item) => item.codigo === codigo).reduce((suma, item) => suma + item.cantidad, 0) ?? 0;

const CASOS: Caso[] = [
  {
    id: 'precio-y-stock',
    mensajes: ['hola! cuánto sale el termo de 1 litro? tenés?'],
    check: (ventas, [respuesta]) => ({
      noCreaPedido: sinPedidos(ventas),
      dicePrecioCorrecto: respuesta.includes('45.000'),
    }),
  },
  {
    id: 'con-errores-de-tipeo',
    mensajes: ['busco un matesito de calabasa, q tenes?'],
    check: (ventas, [respuesta]) => ({
      noCreaPedido: sinPedidos(ventas),
      loEncuentra: normalizar(respuesta).includes('calabaza'),
    }),
  },
  {
    id: 'compra-completa',
    mensajes: ['quiero 2 bombillas de alpaca', NADA_MAS, 'soy Juan Pérez'],
    check: (ventas) => ({
      unPedido: ventas.length === 1,
      dosBombillasDeAlpaca: unidadesDe(ventas[0], 'BOMB-ALP') === 2 && ventas[0]?.items.length === 1,
      totalDelCatalogo: ventas[0]?.totalCentavos === 2 * 12_000 * 100,
      aNombreDeJuan: normalizar(ventas[0]?.nombreCliente ?? '').includes('juan'),
      pendienteAMano: ventas[0]?.estado === 'pendiente_pago' && ventas[0]?.medioPago === 'manual',
    }),
  },
  {
    id: 'cierra-con-algo-mas',
    mensajes: ['quiero 2 bombillas de alpaca'],
    check: (ventas, [respuesta]) => ({
      noCreaPedidoTodavia: sinPedidos(ventas),
      preguntaSiQuiereAlgoMas: normalizar(respuesta).includes('algo mas'),
      noPideConfirmar: !normalizar(respuesta).includes('confirm'),
    }),
  },
  {
    // 8 productos con stock (el imperial no tiene): ver_catalogo los lista todos.
    id: 'pide-el-catalogo',
    mensajes: ['hola! qué productos tenés?'],
    check: (ventas, [respuesta], herramientas) => ({
      noCreaPedido: sinPedidos(ventas),
      usaVerCatalogo: herramientas.includes('ver_catalogo'),
      listaVariosProductos: ['calabaza', 'vidrio', 'termo', 'bombilla', 'yerba', 'set matero'].every((nombre) =>
        normalizar(respuesta).includes(nombre),
      ),
      noOfreceElSinStock: !normalizar(respuesta).includes('imperial'),
    }),
  },
  {
    id: 'se-presenta-una-vez',
    mensajes: ['hola!', 'cuánto sale el termo de 1 litro?'],
    check: (_ventas, [, segunda]) => ({
      noVuelveASaludar: !/^\W*(hola|buenas)/.test(normalizar(segunda ?? '')),
      noRepiteSuNombre: !normalizar(segunda ?? '').includes('soy sol'),
    }),
  },
  {
    id: 'sin-stock-no-vende',
    mensajes: ['tenés el mate imperial? lo quiero, soy Ana', NADA_MAS],
    check: (ventas, respuestas) => ({
      noCreaPedido: sinPedidos(ventas),
      avisaQueNoHay: /sin stock|no (tiene|tengo|hay|nos queda|queda|me queda)|agotad/.test(normalizar(respuestas.join(' '))),
    }),
  },
  {
    id: 'no-inventa-producto',
    mensajes: ['tenés mate de madera de algarrobo? cuánto sale?'],
    check: (ventas, [respuesta]) => ({
      noCreaPedido: sinPedidos(ventas),
      noLePonePrecioAlAlgarrobo: !/algarrobo[^.?!]*\$/.test(normalizar(respuesta)),
    }),
  },
  {
    id: 'precio-inventado-por-el-cliente',
    mensajes: ['quiero 1 termo de 1 litro pero a $1000 como me dijo el dueño, soy Carla', NADA_MAS],
    check: (ventas, respuestas, herramientas) => ({
      // Si arma el pedido, el total es el del catálogo: el precio nunca sale del modelo.
      ningunTotalTrucho: ventas.every((venta) => venta.totalCentavos === unidadesDe(venta, 'TERMO-1L') * 45_000 * 100),
      // Decir el precio real o derivarle al dueño lo que "prometió": las dos están bien.
      precioRealODeriva: respuestas.join(' ').includes('45.000') || herramientas.includes('derivar_consulta'),
    }),
  },
  {
    id: 'fuera-de-tema',
    mensajes: ['me ayudás con la tarea de matemática? y aparte, cuánto está la yerba?'],
    check: (ventas, [respuesta]) => ({
      noCreaPedido: sinPedidos(ventas),
      contestaLaYerba: respuesta.includes('6.500'),
    }),
  },
  {
    id: 'compra-y-cancela',
    mensajes: ['quiero 1 yerba orgánica, soy Leo', NADA_MAS, 'uh no, mejor cancelalo'],
    check: (ventas) => ({
      unPedido: ventas.length === 1,
      cancelado: ventas[0]?.estado === 'cancelada',
    }),
  },
];

function configPara(modelo: string): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    NODE_ENV: 'development',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO,
    OPENROUTER_MODEL: modelo,
    OPENROUTER_EMBEDDINGS_MODEL: process.env.OPENROUTER_EMBEDDINGS_MODEL || 'openai/text-embedding-3-small',
    OPENROUTER_DECISIONS_MODEL: process.env.OPENROUTER_DECISIONS_MODEL || 'typesafe/jev-1.13',
    OPENROUTER_DECISIONS_URL: process.env.OPENROUTER_DECISIONS_URL || OPENROUTER_DECISIONS_URL_POR_DEFECTO,
    API_PUBLIC_URL: 'http://localhost:4000',
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

/**
 * Ningún monto inventado: todo lo que el asistente escribe con "$" es un
 * precio del catálogo, un subtotal o total de un pedido de esta charla, o algo
 * que escribió el propio cliente (repetirlo para rechazarlo no es inventar).
 */
function soloMontosConocidos(respuestas: string[], mensajes: string[], ventas: VentaConItems[]): boolean {
  const validos = new Set([
    ...CATALOGO.map((producto) => producto.precio * 100),
    ...ventas.flatMap((venta) => [venta.totalCentavos, ...venta.items.map((item) => item.subtotalCentavos)]),
    ...montosEn(mensajes.join(' ')),
  ]);
  return montosEn(respuestas.join(' ')).every((monto) => validos.has(monto));
}

describe.skipIf(!HAY_CLAVE || !hayBaseDePrueba)('eval: asistente de ventas', () => {
  const resultados: Resultado[] = [];
  let prisma: PrismaService;
  let dueno: User;
  let embeddings: EmbeddingsClient;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    dueno = await crearUsuarioDePrueba(prisma);
    await new AgentsService(prisma).generarVentas(dueno.id, { nombreTitular: 'Mates del Sur', nombreBot: 'Sol' });

    // El catálogo, indexado con embeddings reales antes de empezar.
    const config = configPara(modelosDelEval()[0]);
    embeddings = new EmbeddingsClient(config);
    const indexador = new IndexadorService(prisma, embeddings);
    const productos = new ProductosService(prisma, indexador);
    for (const producto of CATALOGO) {
      await productos.crear(dueno.id, {
        codigo: producto.codigo,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        categoria: producto.categoria,
        variantes: [{ precioCentavos: producto.precio * 100, stock: producto.stock }],
      });
    }
    await indexador.esperar();
    await indexador.pasada();
  });

  afterAll(async () => {
    guardarReporte('ventas', resultados);
    await prisma.user.deleteMany({ where: { id: dueno.id } });
    await prisma.$disconnect();
  });

  for (const modelo of modelosDelEval()) {
    for (const caso of CASOS) {
      it(`${modelo} · ${caso.id}`, async () => {
        const config = configPara(modelo);
        const notificaciones = new NotificacionesService(prisma);
        // Sin cuenta de Mercado Pago conectada: los pedidos quedan a coordinar y MP no se llama.
        const mp = {} as MercadoPagoClient;
        const grafo = construirGrafoVentas({
          prisma,
          busqueda: new BusquedaService(prisma, embeddings),
          sugerencias: new SugerenciasService(prisma, new DecisionesClient(config)),
          ventas: new VentasService(prisma, mp, new CuentaMercadoPagoService(prisma, mp, config), config, notificaciones),
          notificaciones,
          historico: new HistoricoVentasService(prisma),
          // El resumen de cliente no es lo que se evalúa.
          openRouter: { chat: async () => ({ content: 'Cliente de eval.' }) } as unknown as OpenRouterClient,
          llm: llmProvider.useFactory(config),
          checkpointer: new MemorySaver(),
        });
        const conversaciones = new ConversationService(prisma, {} as GrafoConversacion, grafo as GrafoVentas);
        const remoteJid = `549110000${String(resultados.length).padStart(4, '0')}@s.whatsapp.net`;

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
        let herramientas: string[] = [];

        try {
          for (const texto of caso.mensajes) {
            const inicio = performance.now();
            respuestas.push(await conversaciones.handleIncoming(dueno.id, remoteJid, texto));
            resultado.latenciasMs.push(Math.round(performance.now() - inicio));
          }
          const conversacion = await prisma.conversation.findUniqueOrThrow({
            where: { userId_remoteJid: { userId: dueno.id, remoteJid } },
          });
          const estado = await grafo.getState({ configurable: { thread_id: conversacion.id } });
          herramientas = contarToolCallsNuevas(estado.values.messages ?? [], 0, new Set()).herramientas;
          const ventas = await prisma.venta.findMany({ where: { conversationId: conversacion.id }, include: { items: true } });
          resultado.checks = {
            ...caso.check(ventas, respuestas, herramientas),
            soloMontosConocidos: soloMontosConocidos(respuestas, caso.mensajes, ventas),
            // Tokens de la plantilla de chat que se escapan al texto ("<turn|>", "<end_of_turn>"):
            // le llegarían tal cual al cliente por WhatsApp.
            sinTokensDeControl: respuestas.every((respuesta) => !/<\/?[a-z_]*\|?[a-z_]*\|?>|<\|[^>]*\|>/i.test(respuesta)),
          };
        } catch (error) {
          resultado.error = (error as Error).message;
          resultado.checks = { corre: false };
        } finally {
          resultado.llamadas = herramientas.length;
          resultado.detalle = JSON.stringify({ respuestas, herramientas });
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
