/**
 * Definiciones (nombre, descripción y schema zod) de las herramientas que se
 * le ofrecen al modelo. Acá NO se ejecuta nada: la validación contra la agenda
 * la hace el nodo `validacion` del grafo y las escrituras reales el nodo
 * `calendar` (api/src/conversation/graph/nodes). El mapeo 1:1 con
 * agent-catalog.ts se mantiene: agregar una acción implica agregar su schema acá.
 */
import { z } from 'zod';
import type { AccionId } from '../agents/agent-catalog.js';

/**
 * Forma de una herramienta tal como se la pasamos al modelo. Es compatible con
 * `StructuredToolParams` de LangChain (lo que espera `bindTools`), pero deja el
 * schema tipado como zod para poder validar los argumentos en el nodo de
 * validación sin castear.
 */
export type EsquemaHerramienta = {
  name: string;
  description: string;
  schema: z.ZodType<Record<string, unknown>>;
};

const ISO = 'ISO 8601 con horario y offset, ej "2026-09-05T14:00:00-03:00".';

export const esquemaDisponibilidad = z.object({
  desde: z.string().describe(`Inicio del rango a chequear, ${ISO}`),
  hasta: z.string().describe(`Fin del rango a chequear, ${ISO}`),
});

export const esquemaCrearTurno = z.object({
  nombreCliente: z
    .string()
    .describe(
      'Nombre de la persona para la que es el turno. Obligatorio: si no lo sabés, preguntáselo antes de llamar esta herramienta.',
    ),
  resumen: z.string().describe('Tipo de turno, ej "Corte de pelo". El nombre se agrega solo.'),
  inicio: z.string().describe(`Inicio del turno, ${ISO}`),
  fin: z.string().describe(`Fin del turno, ${ISO}`),
});

export const esquemaReprogramar = z.object({
  inicio: z.string().describe(`Nuevo inicio, ${ISO}`),
  fin: z.string().describe(`Nuevo fin, ${ISO}`),
});

export const esquemaVacio = z.object({});

/** Un schema por cada acción de agent-catalog.ts — mismos ids. */
export const ESQUEMAS_ACCIONES: Record<AccionId, EsquemaHerramienta> = {
  consultar_disponibilidad: {
    name: 'consultar_disponibilidad',
    description:
      'Consulta si un rango horario está libre en el calendario antes de ofrecérselo al cliente. ' +
      'La disponibilidad de los próximos días ya te la paso en el contexto: usá esta herramienta ' +
      'sólo para fechas más lejanas o para confirmar antes de agendar.',
    schema: esquemaDisponibilidad,
  },
  crear_turno: {
    name: 'crear_turno',
    description:
      'Agenda un turno nuevo. Usar sólo después de confirmar disponibilidad, de saber el nombre ' +
      'de la persona y de que el cliente confirmó el horario.',
    schema: esquemaCrearTurno,
  },
  cancelar_turno: {
    name: 'cancelar_turno',
    description: 'Cancela el turno vigente de esta conversación. No recibe parámetros.',
    schema: esquemaVacio,
  },
  reprogramar_turno: {
    name: 'reprogramar_turno',
    description: 'Mueve el turno vigente de esta conversación a un nuevo horario.',
    schema: esquemaReprogramar,
  },
  consultar_turno: {
    name: 'consultar_turno',
    description: 'Busca los turnos ya agendados en esta conversación. No recibe parámetros.',
    schema: esquemaVacio,
  },
};

/**
 * Herramientas que sólo se ofrecen cuando quien habla es el dueño (el banco de
 * pruebas del Home, nunca un cliente real de WhatsApp — ver
 * `esConversacionDePrueba` en conversation.service.ts). No tienen un `AccionId`
 * de agent-catalog.ts: no son algo que el meta-agente pueda habilitarle a un
 * agente que atiende clientes, porque le darían acceso a cualquier evento del
 * calendario del dueño, no sólo a los turnos de esa conversación puntual.
 */
export const ESQUEMAS_PROPIETARIO: Record<string, EsquemaHerramienta> = {
  listar_eventos_calendario: {
    name: 'listar_eventos_calendario',
    description:
      'Lista TODOS los eventos del Google Calendar del dueño en un rango de fechas, no sólo los agendados ' +
      'en esta conversación. Usar antes de cancelar_evento_calendario o editar_evento_calendario para ' +
      'encontrar el id del evento correcto.',
    schema: z.object({
      desde: z.string().describe(`Inicio del rango, ${ISO}`),
      hasta: z.string().describe(`Fin del rango, ${ISO}`),
    }),
  },
  cancelar_evento_calendario: {
    name: 'cancelar_evento_calendario',
    description:
      'Cancela (elimina) un evento del Google Calendar del dueño por su id. Flujo obligatorio en dos pasos: ' +
      '1) usá listar_eventos_calendario para encontrar el evento y mostrale al dueño de cuál se trata (fecha, ' +
      'horario y título) y esperá que confirme por texto; 2) recién cuando confirme, llamá esta herramienta ' +
      'de nuevo con confirmado: true. Nunca mandes confirmado: true sin que el dueño haya confirmado antes.',
    schema: z.object({
      eventoId: z.string().describe('Id del evento, obtenido con listar_eventos_calendario.'),
      confirmado: z
        .boolean()
        .describe(
          'true sólo si el dueño ya vio el evento (fecha, horario, título) y confirmó por texto que quiere cancelarlo.',
        ),
    }),
  },
  editar_evento_calendario: {
    name: 'editar_evento_calendario',
    description:
      'Edita horario y/o título de un evento del Google Calendar del dueño por su id. Mandá sólo los ' +
      'campos que cambian. Flujo obligatorio en dos pasos: 1) usá listar_eventos_calendario para encontrar ' +
      'el evento y mostrale al dueño de cuál se trata (fecha, horario y título) junto con el cambio propuesto, ' +
      'y esperá que confirme por texto; 2) recién cuando confirme, llamá esta herramienta de nuevo con ' +
      'confirmado: true. Nunca mandes confirmado: true sin que el dueño haya confirmado antes.',
    schema: z.object({
      eventoId: z.string().describe('Id del evento, obtenido con listar_eventos_calendario.'),
      inicio: z.string().optional().describe(`Nuevo inicio, ${ISO} (opcional).`),
      fin: z.string().optional().describe(`Nuevo fin, ${ISO} (opcional).`),
      resumen: z.string().optional().describe('Nuevo título del evento (opcional).'),
      confirmado: z
        .boolean()
        .describe(
          'true sólo si el dueño ya vio el evento y el cambio propuesto, y confirmó por texto que quiere editarlo.',
        ),
    }),
  },
};

export function esHerramientaPropietario(nombre: string): boolean {
  return Object.hasOwn(ESQUEMAS_PROPIETARIO, nombre);
}
