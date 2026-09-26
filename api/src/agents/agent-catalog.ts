/**
 * Catálogo fijo de acciones que un agente puede tener habilitadas. El
 * meta-agente (agents.service.ts) elige un subconjunto de estos ids al
 * generar la config de un usuario — nunca inventa ids nuevos. El runtime
 * conversacional (api/src/conversation) tiene un tool 1:1 con cada uno de
 * estos ids, así que agregar una acción acá implica agregar su tool ahí.
 */
export const ACCIONES_DISPONIBLES = {
  consultar_disponibilidad: 'Ver si un día/horario está libre antes de ofrecerlo.',
  crear_turno: 'Agendar un turno nuevo una vez que el cliente confirmó día y horario.',
  cancelar_turno: 'Cancelar el turno vigente de esta conversación.',
  reprogramar_turno: 'Mover el turno vigente de esta conversación a otro horario.',
  consultar_turno: 'Buscar y contar el/los turno(s) ya agendado(s) en esta conversación.',
} as const;

export type AccionId = keyof typeof ACCIONES_DISPONIBLES;

export const ACCIONES_IDS = Object.keys(ACCIONES_DISPONIBLES) as AccionId[];

export function esAccionValida(id: string): id is AccionId {
  return (ACCIONES_IDS as string[]).includes(id);
}

/**
 * Catálogo del asistente de ventas (`Agent.tipoAsistente = "ventas"`). Mismo
 * contrato que el de agenda: el grafo de ventas (api/src/conversation/ventas)
 * tiene un tool 1:1 con cada id, así que agregar una acción acá implica
 * agregar su schema en ventas-tools.ts.
 */
export const ACCIONES_VENTAS = {
  buscar_productos: 'Buscar en el catálogo lo que pide el cliente, con precio y stock reales.',
} as const;

export type AccionVentasId = keyof typeof ACCIONES_VENTAS;

export const ACCIONES_VENTAS_IDS = Object.keys(ACCIONES_VENTAS) as AccionVentasId[];

export function esAccionDeVentas(id: string): id is AccionVentasId {
  return (ACCIONES_VENTAS_IDS as string[]).includes(id);
}

/**
 * Qué hace el asistente: agendar turnos o vender. Define qué grafo atiende la
 * conversación. Una cuenta elige uno en /contanos y no lo cambia.
 */
export const TIPOS_ASISTENTE = ['agenda', 'ventas'] as const;

export type TipoAsistente = (typeof TIPOS_ASISTENTE)[number];

/** La columna es un string: cualquier cosa que no sea "ventas" es la agenda de siempre. */
export function tipoAsistenteDe(agent: { tipoAsistente: string }): TipoAsistente {
  return agent.tipoAsistente === 'ventas' ? 'ventas' : 'agenda';
}

export const TIPOS_USO = ['comercio', 'consultorio', 'reuniones', 'visitas', 'personal', 'otro'] as const;

/**
 * Ids que el wizard web ya no ofrece pero la API sigue aceptando: hay `Agent`
 * guardados con ese `tipoUso` y regenerarlos (o leerlos) no debe romper.
 */
export const TIPOS_USO_RETIRADOS = ['comercio', 'reuniones', 'visitas', 'personal'] as const satisfies readonly TipoUso[];

export type TipoUso = (typeof TIPOS_USO)[number];

/** Quién atiende: cambia cómo se presenta el asistente ("soy el asistente de …"). */
export const TIPOS_TITULAR = ['persona', 'negocio'] as const;

export type TipoTitular = (typeof TIPOS_TITULAR)[number];
