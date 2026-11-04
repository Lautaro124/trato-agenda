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

/** Lo que se pide al cerrar un pedido. */
const entregaDelPedido = z
  .enum(['envio', 'retiro'])
  .optional()
  .describe('Sólo si las reglas de venta dicen que el negocio hace envíos: lo que eligió el cliente.');

const datosClienteDelPedido = z
  .array(
    z.object({
      campo: z.string().describe('El nombre del dato tal cual figura en las reglas de venta.'),
      valor: z.string().describe('Lo que contestó el cliente, sin cambiarlo.'),
    }),
  )
  .optional()
  .describe('Sólo los datos que las reglas de venta te piden pedirle al cliente, con lo que te dio.');

const respuestasDelPedido = z
  .array(
    z.object({
      productoId: z.string().describe('El id [producto …] del producto al que responde.'),
      pregunta: z.number().int().describe('El número de la pregunta en "preguntas al pedirlo" de ese producto (desde 1).'),
      respuesta: z.string().describe('Lo que contestó el cliente; en las de opciones, una de las opciones tal cual.'),
    }),
  )
  .optional()
  .describe(
    'Sólo si algún producto trae "preguntas al pedirlo": las respuestas del cliente, una por pregunta, una sola ' +
      'vez por producto aunque pida varias unidades.',
  );

export const esquemaCrearPedido = z.object({
  nombreCliente: z
    .string()
    .describe('Nombre de la persona que compra. Obligatorio: si no lo sabés, preguntáselo antes.'),
  items: z
    .array(
      z.object({
        productoId: z
          .string()
          .describe('El id [producto …] de una búsqueda de esta charla, nunca uno inventado.'),
        cantidad: z.number().int().describe('Unidades de ese producto.'),
      }),
    )
    .describe('Todo lo que el cliente eligió en esta charla.'),
  formaPago: z
    .enum(['efectivo', 'cuotas'])
    .optional()
    .describe(
      'Sólo si el cliente eligió una de las formas de pago que devolvió ver_formas_de_pago: "efectivo" (con su ' +
        'descuento, se coordina por chat) o "cuotas" (con el plan de `cuotas`). Si no eligió ninguna, no la mandes.',
    ),
  cuotas: z.number().int().optional().describe('Con formaPago "cuotas": la cantidad de un plan de ver_formas_de_pago.'),
  medioPago: z
    .enum(['mercadopago', 'manual'])
    .optional()
    .describe(
      '"mercadopago" manda un link de pago; "manual" deja el pedido anotado para que el negocio coordine el pago ' +
        '(transferencia, efectivo). Si no lo sabés, no lo mandes: se usa el que corresponde al negocio.',
    ),
  entrega: entregaDelPedido,
  datosCliente: datosClienteDelPedido,
  respuestas: respuestasDelPedido,
});

export const esquemaEnviarImagen = z.object({
  productoId: z
    .string()
    .describe('El id de producto entre corchetes de una búsqueda de esta charla, de uno que diga "tiene foto".'),
});

export const ESQUEMAS_VENTAS: Record<AccionVentasId, EsquemaHerramienta> = {
  buscar_productos: {
    name: 'buscar_productos',
    description:
      'Busca en el catálogo del negocio y devuelve los productos que coinciden, cada uno con su ' +
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
  ver_descuentos: {
    name: 'ver_descuentos',
    description:
      'Devuelve todos los descuentos y promociones vigentes del negocio: las promos de todo el catálogo o de una ' +
      'categoría y los productos con descuento, con el precio final. Usala cuando el cliente pregunta por ' +
      'descuentos, promos u ofertas, o te dice que sí cuando le ofreciste pasárselos.',
    schema: z.object({}),
  },
  ver_formas_de_pago: {
    name: 'ver_formas_de_pago',
    description:
      'Devuelve las formas de pago del negocio (cuotas de los productos, descuento en efectivo). Con ' +
      '`items`, además el total del pedido en cada una y el valor de cada cuota. Usala cuando el cliente pregunta ' +
      'por cuotas, efectivo o cómo puede pagar: nunca calcules vos esos montos.',
    schema: z.object({
      items: esquemaCrearPedido.shape.items
        .optional()
        .describe('Opcional: lo que el cliente eligió en esta charla, para darle los totales.'),
    }),
  },
  crear_pedido: {
    name: 'crear_pedido',
    description:
      'Crea el pedido: reserva el stock y devuelve el link de pago (o lo deja anotado para coordinar). Usala cuando ' +
      'el cliente ya eligió y te dijo que no quiere nada más, con todo lo que eligió en esta charla. Los precios los ' +
      'pone el sistema: vos sólo mandás productos y cantidades.',
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
      'Le pasa al equipo del negocio una consulta que vos no podés responder (un producto que no está en el ' +
      'catálogo, envíos, formas de pago, un reclamo). Después decile al cliente que en un rato le escribimos por ' +
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
  enviar_imagen_producto: {
    name: 'enviar_imagen_producto',
    description:
      'Le manda al cliente la foto de un producto, junto con tu ' +
      'respuesta. Usala cuando el cliente pide ver el producto o una foto, o cuando las reglas de venta dicen que ' +
      'la mandes sola, y sólo con lo que la búsqueda marcó "tiene foto". Una llamada por foto.',
    schema: esquemaEnviarImagen,
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
      'Para el dueño: busca productos del catálogo y devuelve el stock exacto de cada uno (unidades, ' +
      'reservadas y mínimo), no la versión resumida que ve un cliente.',
    schema: z.object({
      consulta: z.string().describe('Nombre, código o descripción del producto.'),
    }),
  },
};

/** Acciones que llegaron después de los primeros asistentes y vienen con `buscar_productos`. */
const ACCIONES_CON_LA_BUSQUEDA: AccionVentasId[] = [
  'ver_catalogo',
  'ver_descuentos',
  'ver_formas_de_pago',
  'enviar_imagen_producto',
];

/**
 * Las acciones de ventas que tiene un agente. `ver_catalogo`, `ver_descuentos`,
 * `ver_formas_de_pago` y `enviar_imagen_producto` llegaron después de que se crearan los primeros
 * asistentes, y su `allowedActions` está guardado sin ellas: las tiene todo
 * agente que puede buscar en el catálogo, sin migrar ni regenerar nada (lo
 * mismo que los bloques de reglas que viven en código).
 */
export function accionesDeVentas(allowedActions: string[]): AccionVentasId[] {
  const acciones = allowedActions.filter(esAccionDeVentas);
  if (acciones.includes('buscar_productos')) {
    for (const accion of ACCIONES_CON_LA_BUSQUEDA) if (!acciones.includes(accion)) acciones.push(accion);
  }
  return acciones;
}

/** Herramientas visibles para un agente de ventas: las habilitadas + las del dueño si corresponde. */
export function herramientasDeVentas(allowedActions: string[], esPropietario: boolean): EsquemaHerramienta[] {
  return [
    ...accionesDeVentas(allowedActions).map((id) => ESQUEMAS_VENTAS[id]),
    ...(esPropietario ? Object.values(ESQUEMAS_PROPIETARIO_VENTAS) : []),
  ];
}
