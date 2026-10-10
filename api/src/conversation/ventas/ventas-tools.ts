/**
 * Herramientas del asistente de ventas: sólo definiciones (nombre,
 * descripción y schema zod), igual que conversation-tools.ts para la agenda.
 * Las valida el nodo `validacion_ventas` y las ejecuta el nodo `catalogo`.
 * Un schema por cada id de ACCIONES_VENTAS (agent-catalog.ts).
 */
import { z } from 'zod';
import { esAccionDeVentas, type AccionVentasId } from '../../agents/agent-catalog.js';
import type { EsquemaHerramienta } from '../conversation-tools.js';

export const esquemaBuscarProductos = z.object({
  consulta: z
    .string()
    .describe(
      'Qué busca el cliente, en sus palabras o resumido: "remera negra talle M", "algo para regalar a alguien ' +
        'que toma mate", un código. Una búsqueda por producto que te pidan.',
    ),
  categoria: z
    .string()
    .optional()
    .describe('Opcional: una categoría exacta de la lista del contexto, para acotar la búsqueda.'),
});

export const esquemaVerCatalogo = z.object({
  categoria: z
    .string()
    .optional()
    .describe(
      'Opcional: la categoría que eligió el cliente, tal como se la sugeriste. Sin categoría, devuelve el ' +
        'listado entero si son pocos productos o las categorías para sugerirle si son muchos.',
    ),
});

export const esquemaCrearPedido = z.object({
  nombreCliente: z
    .string()
    .describe('Nombre de la persona que compra. Obligatorio: si no lo sabés, preguntáselo antes.'),
  items: z
    .array(
      z.object({
        varianteId: z
          .string()
          .describe('El id de variante entre corchetes de una búsqueda de esta charla, nunca uno inventado.'),
        cantidad: z.number().int().describe('Unidades de esa variante.'),
      }),
    )
    .describe('Todo lo que el cliente eligió en esta charla.'),
  medioPago: z
    .enum(['mercadopago', 'manual'])
    .optional()
    .describe(
      '"mercadopago" manda un link de pago; "manual" deja el pedido anotado para que el negocio coordine el pago ' +
        '(transferencia, efectivo). Si no lo sabés, no lo mandes: se usa el que corresponde al negocio.',
    ),
  entrega: z
    .enum(['envio', 'retiro'])
    .optional()
    .describe('Sólo si las reglas de venta dicen que el negocio hace envíos: lo que eligió el cliente.'),
  datosCliente: z
    .array(
      z.object({
        campo: z.string().describe('El nombre del dato tal cual figura en las reglas de venta.'),
        valor: z.string().describe('Lo que contestó el cliente, sin cambiarlo.'),
      }),
    )
    .optional()
    .describe('Sólo los datos que las reglas de venta te piden pedirle al cliente, con lo que te dio.'),
});

export const ESQUEMAS_VENTAS: Record<AccionVentasId, EsquemaHerramienta> = {
  buscar_productos: {
    name: 'buscar_productos',
    description:
      'Busca en el catálogo del negocio y devuelve los productos que coinciden, cada uno con sus variantes, ' +
      'precio y stock reales. Usala SIEMPRE antes de hablar de un producto, de su precio o de si hay: sin ' +
      'buscar no sabés nada del catálogo.',
    schema: esquemaBuscarProductos,
  },
  ver_catalogo: {
    name: 'ver_catalogo',
    description:
      'Muestra lo que vende el negocio cuando el cliente pregunta en general qué tenés, qué le ofrecés o pide ' +
      'la lista de productos (sin un producto puntual: para eso está buscar_productos). Con pocos productos ' +
      'devuelve la lista entera con precios; con muchos, las categorías que más le pueden interesar. Cuando el ' +
      'cliente elige una categoría, llamala de nuevo con esa categoría.',
    schema: esquemaVerCatalogo,
  },
  crear_pedido: {
    name: 'crear_pedido',
    description:
      'Crea el pedido: reserva el stock y devuelve el link de pago (o lo deja anotado para coordinar). Usala sólo ' +
      'después de repetirle al cliente productos, cantidades y total, y de que confirme por texto. Los precios los ' +
      'pone el sistema: vos sólo mandás variantes y cantidades.',
    schema: esquemaCrearPedido,
  },
  consultar_pedido: {
    name: 'consultar_pedido',
    description: 'Devuelve los pedidos de esta conversación con su estado (pendiente de pago, pagado, vencido, cancelado) y el link si sigue vigente.',
    schema: z.object({}),
  },
  derivar_consulta: {
    name: 'derivar_consulta',
    description:
      'Le avisa al dueño del negocio una consulta que vos no podés responder (un producto que no está en el ' +
      'catálogo, envíos, formas de pago, un reclamo). Después decile al cliente que el negocio le responde por ' +
      'este chat. No la uses para cosas que no tienen que ver con el negocio: esas se rechazan.',
    schema: z.object({
      resumen: z.string().describe('Qué necesita el cliente, en una o dos frases, sin datos que no te dio.'),
    }),
  },
  cancelar_pedido: {
    name: 'cancelar_pedido',
    description: 'Cancela el pedido sin pagar más reciente de esta conversación. Usala sólo si el cliente lo pide explícitamente.',
    schema: z.object({}),
  },
};

/**
 * Herramientas que sólo ve el dueño desde el banco de pruebas del Home, nunca
 * un cliente de WhatsApp. Igual que ESQUEMAS_PROPIETARIO de la agenda.
 */
const DIA = 'Día AAAA-MM-DD en la zona del negocio (opcional; sin fechas son los últimos 30 días).';

const esquemaRango = {
  desde: z.string().optional().describe(`Primer día. ${DIA}`),
  hasta: z.string().optional().describe(`Último día, inclusive. ${DIA}`),
};

export const ESQUEMAS_PROPIETARIO_VENTAS: Record<string, EsquemaHerramienta> = {
  listar_ventas: {
    name: 'listar_ventas',
    description:
      'Para el dueño: las ventas y pedidos de un período (los más recientes primero) con cliente, productos, ' +
      'total y estado, más los totales cobrados y pendientes. No incluye los pedidos de prueba.',
    schema: z.object({
      ...esquemaRango,
      estado: z
        .enum(['pendiente_pago', 'pagada', 'cancelada', 'vencida'])
        .optional()
        .describe('Opcional: sólo las de un estado.'),
    }),
  },
  resumen_ventas: {
    name: 'resumen_ventas',
    description: 'Para el dueño: cuánto cobró en un período, cuántas ventas, ticket promedio y los productos más vendidos.',
    schema: z.object(esquemaRango),
  },
  consultar_stock: {
    name: 'consultar_stock',
    description:
      'Para el dueño: busca productos del catálogo y devuelve el stock exacto de cada variante (unidades, ' +
      'reservadas y mínimo), no la versión resumida que ve un cliente.',
    schema: z.object({
      consulta: z.string().describe('Nombre, código o descripción del producto.'),
    }),
  },
};

/**
 * Las acciones de ventas que tiene un agente. `ver_catalogo` llegó después de
 * que se crearan los primeros asistentes, y su `allowedActions` está guardado
 * sin ella: la tiene todo agente que puede buscar en el catálogo, sin migrar
 * ni regenerar nada (lo mismo que los bloques de reglas que viven en código).
 */
export function accionesDeVentas(allowedActions: string[]): AccionVentasId[] {
  const acciones = allowedActions.filter(esAccionDeVentas);
  if (acciones.includes('buscar_productos') && !acciones.includes('ver_catalogo')) acciones.push('ver_catalogo');
  return acciones;
}

/** Herramientas visibles para un agente de ventas: las habilitadas + las del dueño si corresponde. */
export function herramientasDeVentas(allowedActions: string[], esPropietario: boolean): EsquemaHerramienta[] {
  return [
    ...accionesDeVentas(allowedActions).map((id) => ESQUEMAS_VENTAS[id]),
    ...(esPropietario ? Object.values(ESQUEMAS_PROPIETARIO_VENTAS) : []),
  ];
}
