/**
 * Herramientas del asistente de ventas: sólo definiciones (nombre,
 * descripción y schema zod), igual que conversation-tools.ts para la agenda.
 * Las valida el nodo `validacion_ventas` y las ejecuta el nodo `catalogo`.
 * Un schema por cada id de ACCIONES_VENTAS (agent-catalog.ts).
 */
import { z } from 'zod';
import { esAccionDeVentas, type AccionVentasId } from '../../agents/agent-catalog.js';
import { leerModalidad, type ModalidadVenta } from '../../agents/modalidad-venta.js';
import { MOTIVOS_DEL_ASISTENTE } from '../../comercio/pedido-a-medida.rules.js';
import type { Agent } from '../../generated/prisma/client.js';
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

export const esquemaEnviarImagen = z.object({
  productoId: z
    .string()
    .describe('El id de producto entre corchetes de una búsqueda de esta charla, de uno que diga "tiene foto".'),
  varianteId: z
    .string()
    .optional()
    .describe(
      'Opcional: el id entre corchetes de una versión con precio fijo de ese producto, si el cliente eligió esa ' +
        'versión. Si la versión no tiene foto propia, va la del producto.',
    ),
});

export const esquemaPedirVariante = z.object({
  varianteId: z
    .string()
    .describe('El id entre corchetes de una versión con precio fijo de una búsqueda de esta charla, nunca uno inventado.'),
  cantidad: z.number().int().describe('Cuántas quiere de esa versión (1 si no dijo).'),
  nombreCliente: z.string().describe('Nombre de la persona. Obligatorio: si no lo sabés, preguntáselo antes.'),
});

export const esquemaRegistrarSolicitud = z.object({
  productoId: z
    .string()
    .describe('El id de producto entre corchetes de una búsqueda de esta charla, de uno "a medida".'),
  nombreCliente: z.string().describe('Nombre de la persona. Obligatorio: si no lo sabés, preguntáselo antes.'),
  respuestas: z
    .array(
      z.object({
        pregunta: z.string().describe('La pregunta tal cual figura en "para cotizarlo preguntale esto".'),
        respuesta: z.string().describe('Lo que contestó el cliente, sin cambiarlo (en una pregunta de número, sólo el número).'),
      }),
    )
    .describe('Cada pregunta del producto con lo que contestó el cliente.'),
  resumen: z
    .string()
    .describe('Qué quiere el cliente en una o dos frases, con lo que no entra en las preguntas (para cuándo, detalles).'),
  varianteBaseId: z
    .string()
    .optional()
    .describe('Sólo si eligió una versión con precio fijo y le quiere cambiar algo: el id entre corchetes de esa versión.'),
  cambios: z
    .string()
    .optional()
    .describe('Junto con varianteBaseId: qué quiere distinto de esa versión, con sus palabras.'),
});

export const esquemaAceptarPresupuesto = z.object({
  pedidoId: z.string().describe('El id entre corchetes del pedido cotizado, tal cual figura en "Pedidos a medida".'),
});

export const esquemaDerivarAPersona = z.object({
  pedidoId: z
    .string()
    .optional()
    .describe('Opcional: el id entre corchetes del pedido, si es sobre uno de "Pedidos a medida".'),
  motivo: z
    .enum(MOTIVOS_DEL_ASISTENTE)
    .describe(
      '"pide_persona" si quiere hablar con alguien; "falta_info" si para avanzar hace falta algo que vos no podés ' +
        'conseguir; "excepcion" si pide algo fuera de lo habitual; "otro" si no es ninguno.',
    ),
  detalle: z.string().describe('Qué pasa, en una frase, para que la persona del equipo no le tenga que preguntar de nuevo.'),
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
  ver_descuentos: {
    name: 'ver_descuentos',
    description:
      'Devuelve todos los descuentos y promociones vigentes del negocio: las promos de todo el catálogo o de una ' +
      'categoría y los productos con descuento, con el precio final. Usala cuando el cliente pregunta por ' +
      'descuentos, promos u ofertas, o te dice que sí cuando le ofreciste pasárselos.',
    schema: z.object({}),
  },
  crear_pedido: {
    name: 'crear_pedido',
    description:
      'Crea el pedido: reserva el stock y devuelve el link de pago (o lo deja anotado para coordinar). Usala cuando ' +
      'el cliente ya eligió y te dijo que no quiere nada más, con todo lo que eligió en esta charla. Los precios los ' +
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
      'Le manda al cliente la foto de un producto (o de una de sus versiones con precio fijo), junto con tu ' +
      'respuesta. Usala cuando el cliente pide ver el producto o una foto, o cuando las reglas de venta dicen que ' +
      'la mandes sola, y sólo con lo que la búsqueda marcó "tiene foto". Una llamada por foto.',
    schema: esquemaEnviarImagen,
  },
  registrar_solicitud: {
    name: 'registrar_solicitud',
    description:
      'Anota lo que pide el cliente de un producto a medida como un pedido para cotizar, con sus respuestas a las ' +
      'preguntas del producto. Usala cuando ya tenés las respuestas necesarias y el nombre. Devuelve qué decirle: ' +
      'el presupuesto si se pudo calcular, o que se lo pasamos por este chat. Si cambia algo de lo que pidió, ' +
      'llamala de nuevo con las respuestas nuevas.',
    schema: esquemaRegistrarSolicitud,
  },
  pedir_variante: {
    name: 'pedir_variante',
    description:
      'Pide tal cual una versión con precio fijo de un producto a medida y genera el cobro: devuelve el link de pago ' +
      '(o lo deja a coordinar). Usala cuando el cliente eligió una versión sin cambiarle nada y te dijo que no quiere ' +
      'nada más. El precio lo pone el sistema. Si le quiere cambiar algo, no es esta: es registrar_solicitud.',
    schema: esquemaPedirVariante,
  },
  aceptar_presupuesto: {
    name: 'aceptar_presupuesto',
    description:
      'El cliente aceptó el presupuesto de un pedido cotizado: genera el link de pago (o lo deja a coordinar). ' +
      'Usala sólo cuando dijo que sí a un presupuesto que ya tiene.',
    schema: esquemaAceptarPresupuesto,
  },
  derivar_a_persona: {
    name: 'derivar_a_persona',
    description:
      'Le pasa el pedido a una persona del equipo con todo lo hablado. Después de esto vos no contestás más en ' +
      'este chat hasta que te lo devuelvan: decile al cliente que sigue alguien del equipo por acá, sin prometer ' +
      'cuándo. Usala si pide hablar con alguien, si hace falta algo que no podés resolver o si pide algo fuera de ' +
      'lo habitual.',
    schema: esquemaDerivarAPersona,
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
        .enum(['solicitado', 'a_cotizar', 'cotizado', 'pendiente_pago', 'pagada', 'cancelada', 'vencida'])
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

/** Acciones que llegaron después de los primeros asistentes y vienen con `buscar_productos`. */
const ACCIONES_CON_LA_BUSQUEDA: AccionVentasId[] = ['ver_catalogo', 'ver_descuentos', 'enviar_imagen_producto'];

/**
 * Lo que cierra o deshace una compra del catálogo. A pedido (LAU-21) no hay
 * stock que reservar: la solicitud se anota con registrar_solicitud, así que
 * estas herramientas ni se le muestran al modelo ni se aceptan.
 */
const ACCIONES_SOLO_CON_STOCK: AccionVentasId[] = ['crear_pedido', 'cancelar_pedido'];

/**
 * Lo que sólo existe a pedido (LAU-24/26/27): anotar la solicitud, pedir una
 * versión de precio fijo, cobrar un presupuesto aceptado y pasarle el pedido a
 * una persona. Llegaron después de
 * los primeros asistentes: las tiene toda cuenta a pedido, sin migrar nada.
 */
const ACCIONES_SOLO_A_PEDIDO: AccionVentasId[] = [
  'registrar_solicitud',
  'pedir_variante',
  'aceptar_presupuesto',
  'derivar_a_persona',
];

/**
 * Las acciones de ventas que tiene un agente. `ver_catalogo`,
 * `ver_descuentos` y `enviar_imagen_producto` llegaron después de que se crearan los primeros
 * asistentes, y su `allowedActions` está guardado sin ellas: las tiene todo
 * agente que puede buscar en el catálogo, sin migrar ni regenerar nada (lo
 * mismo que los bloques de reglas que viven en código).
 */
export function accionesDeVentas(allowedActions: string[], modalidad: ModalidadVenta = 'stock'): AccionVentasId[] {
  const acciones = allowedActions.filter(esAccionDeVentas);
  if (acciones.includes('buscar_productos')) {
    for (const accion of ACCIONES_CON_LA_BUSQUEDA) if (!acciones.includes(accion)) acciones.push(accion);
  }
  if (modalidad !== 'pedido') return acciones.filter((accion) => !ACCIONES_SOLO_A_PEDIDO.includes(accion));
  return [
    ...acciones.filter((accion) => !ACCIONES_SOLO_CON_STOCK.includes(accion) && !ACCIONES_SOLO_A_PEDIDO.includes(accion)),
    ...ACCIONES_SOLO_A_PEDIDO,
  ];
}

/** Herramientas visibles para un agente de ventas: las habilitadas + las del dueño si corresponde. */
export function herramientasDeVentas(
  allowedActions: string[],
  esPropietario: boolean,
  agent?: Pick<Agent, 'modalidadVenta'>,
): EsquemaHerramienta[] {
  return [
    ...accionesDeVentas(allowedActions, agent ? leerModalidad(agent) : 'stock').map((id) => ESQUEMAS_VENTAS[id]),
    ...(esPropietario ? Object.values(ESQUEMAS_PROPIETARIO_VENTAS) : []),
  ];
}
