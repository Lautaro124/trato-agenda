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

export const esquemaCrearPedido = z.object({
  nombreCliente: z
    .string()
    .describe('Nombre de la persona que compra. Obligatorio: si no lo sabés, preguntáselo antes.'),
  items: z
    .array(
      z.object({
        varianteId: z.string().describe('El id de variante entre corchetes de la última búsqueda, nunca uno inventado.'),
        cantidad: z.number().int().describe('Unidades de esa variante.'),
      }),
    )
    .describe('Lo que el cliente confirmó que compra.'),
  medioPago: z
    .enum(['mercadopago', 'manual'])
    .optional()
    .describe(
      '"mercadopago" manda un link de pago; "manual" deja el pedido anotado para que el negocio coordine el pago ' +
        '(transferencia, efectivo). Si no lo sabés, no lo mandes: se usa el que corresponde al negocio.',
    ),
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
export const ESQUEMAS_PROPIETARIO_VENTAS: Record<string, EsquemaHerramienta> = {
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

/** Herramientas visibles para un agente de ventas: las habilitadas + las del dueño si corresponde. */
export function herramientasDeVentas(allowedActions: string[], esPropietario: boolean): EsquemaHerramienta[] {
  return [
    ...allowedActions.filter(esAccionDeVentas).map((id) => ESQUEMAS_VENTAS[id]),
    ...(esPropietario ? Object.values(ESQUEMAS_PROPIETARIO_VENTAS) : []),
  ];
}
