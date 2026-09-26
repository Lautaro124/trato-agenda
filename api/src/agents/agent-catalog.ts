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
