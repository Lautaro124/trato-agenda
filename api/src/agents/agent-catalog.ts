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

export type TipoUso = (typeof TIPOS_USO)[number];
