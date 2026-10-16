/**
 * Dónde se dan los turnos (LAU-17), contado al modelo del asistente de agenda.
 * Sale de `Agent.local` leído en modo agenda (agents/local.ts) y se arma en
 * código en cada mensaje, igual que `bloqueLocal` en ventas: guardarlo desde
 * /cuenta no regenera el system prompt y aplica a los agentes ya creados.
 *
 * La casa del titular no es un local: su dirección exacta no entra al prompt
 * de un cliente que todavía no tiene turno, así el modelo no la puede pasar
 * aunque se la pidan. La recibe con el turno: `lineaDeLugarParaTurno` va en la
 * respuesta de crear_turno/reprogramar_turno, que es lo que el modelo lee
 * justo antes de avisar que quedó agendado (el prompt de ese mensaje ya se
 * había armado sin el turno).
 *
 * Todo puro: lo usan el nodo cargar_contexto y el nodo calendar.
 */
import { leerLocal, type LocalPresencial } from '../../agents/local.js';
import type { Agent } from '../../generated/prisma/client.js';

type ConLugar = Pick<Agent, 'local' | 'nombreTitular'>;

/** El lugar de una agenda, o null si nunca lo cargó (agentes anteriores a LAU-17). */
export function leerLugar(agent: Pick<Agent, 'local'>): LocalPresencial | null {
  return leerLocal(agent, 'agenda');
}

/** Si el lugar ya se cargó (aunque sea "sin lugar fijo"): con eso el modelo deja de decir que no lo sabe. */
export function tieneLugarCargado(agent: Pick<Agent, 'local'>): boolean {
  return leerLugar(agent) !== null;
}

function lineasDeDireccion(local: LocalPresencial): string[] {
  return [
    `- Dirección: ${JSON.stringify(local.direccion ?? '')}.`,
    local.enlaceUbicacion
      ? `- Ubicación en el mapa (mandala tal cual si preguntan cómo llegar): ${local.enlaceUbicacion}`
      : '- No hay un link de ubicación cargado: no armes uno.',
  ];
}

/**
 * El bloque del prompt. `tieneTurno`: esta conversación ya tiene un turno
 * confirmado, que es lo que habilita pasar la dirección de una casa.
 */
export function bloqueLugar(
  agent: ConLugar,
  { esPropietario, tieneTurno }: { esPropietario: boolean; tieneTurno: boolean },
): string {
  const titular = agent.nombreTitular || 'este negocio';
  const lugar = leerLugar(agent);
  if (!lugar) {
    return esPropietario
      ? `Lugar de atención: todavía no está cargado (se carga en Cuenta). Si te preguntan dónde se atiende, decí que no lo tenés.`
      : `Lugar de atención: no sabés dónde atiende ${titular}. Si te preguntan dónde es o la dirección, no la inventes: ` +
          `decile que eso lo consulte directamente con ${titular}.`;
  }
  if (!lugar.tieneLocal) {
    return (
      `Lugar de atención: ${titular} no atiende en un lugar fijo (atiende online o a domicilio). No hay una dirección ` +
      `para dar: si preguntan dónde es, decí que no hay un lugar fijo y que eso lo coordina ${titular}. Nunca inventes una.`
    );
  }

  const encabezado = `Lugar de atención de ${titular} (lo cargó el dueño: usá estos datos tal cual y no agregues nada que no esté acá):`;
  if (lugar.lugar === 'casa') {
    if (!esPropietario && !tieneTurno) {
      return (
        `Lugar de atención: ${titular} atiende en su casa. La dirección exacta se la pasás a este cliente recién ` +
        `cuando tenga el turno agendado (te llega en la respuesta de crear_turno). Si la pide antes, decile que es en ` +
        `la casa de ${titular} y que se la mandás apenas quede agendado. Nunca inventes una dirección, un barrio ni una zona.`
      );
    }
    return [
      encabezado,
      `- Atiende en su casa.`,
      ...lineasDeDireccion(lugar),
      esPropietario
        ? `- A los clientes la dirección les llega recién con el turno agendado.`
        : `- Este cliente ya tiene turno: si pregunta dónde es, pasale la dirección.`,
    ].join('\n');
  }
  return [
    encabezado,
    `- Atiende en un local o consultorio.`,
    ...lineasDeDireccion(lugar),
    `- Si te preguntan dónde es, pasale la dirección.`,
  ].join('\n');
}

/**
 * Lo que se agrega a la respuesta de un turno agendado o reprogramado: dónde
 * es, para que el modelo lo diga en el mismo mensaje. Vacío si no hay una
 * dirección que dar.
 */
export function lineaDeLugarParaTurno(agent: Pick<Agent, 'local'>): string {
  const lugar = leerLugar(agent);
  if (!lugar?.tieneLocal || !lugar.direccion) return '';
  const mapa = lugar.enlaceUbicacion ? ` (ubicación en el mapa: ${lugar.enlaceUbicacion})` : '';
  const donde = lugar.lugar === 'casa' ? 'en su casa' : 'en el local';
  return (
    ` Lugar: ${donde}, ${JSON.stringify(lugar.direccion)}${mapa}. Decíselo al cliente en el mismo mensaje en que ` +
    `le avisás que quedó agendado.`
  );
}
