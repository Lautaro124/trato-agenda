/**
 * Llevar un `Agent` ya guardado a la plantilla vigente. Todo puro, como
 * agent-template.ts: qué agentes están al día y qué hay que reescribir en los
 * que no. Lo aplica ActualizacionAgentesService al arrancar la API, así que
 * subir PLANTILLA_VERSION o PLANTILLA_VENTAS_VERSION regenera todos los
 * agentes en el próximo deploy (también los del viejo meta-agente).
 *
 * Sólo se reescribe lo que deriva de la plantilla (system prompt, acciones,
 * descripción, versión): nombres, horarios y tipos de turno salen de la misma
 * fila y no cambian.
 */
import type { Agent, Prisma } from '../generated/prisma/client.js';
import { tipoAsistenteDe, type TipoTitular, type TipoUso } from './agent-catalog.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import { PLANTILLA_VENTAS_VERSION, construirConfiguracionVentas } from './agent-template-ventas.js';
import { construirDescripcion, construirDescripcionVentas } from './agents.service.js';
import type { GenerateAgentDto, TipoEventoDto } from './agents.types.js';

export type FilaAgente = Pick<
  Agent,
  | 'tipoAsistente'
  | 'tipoTitular'
  | 'nombreTitular'
  | 'tipoUso'
  | 'tiposEvento'
  | 'horaDesde'
  | 'horaHasta'
  | 'nombreBot'
  | 'model'
  | 'templateVersion'
>;

export type DatosVigentes = {
  systemPrompt: string;
  allowedActions: string[];
  descripcion: string;
  model: null;
  templateVersion: number;
};

export type Regeneracion = { ok: true; data: DatosVigentes } | { ok: false; motivo: string };

export function versionVigente(agent: Pick<Agent, 'tipoAsistente'>): number {
  return tipoAsistenteDe(agent) === 'ventas' ? PLANTILLA_VENTAS_VERSION : PLANTILLA_VERSION;
}

/** Generado con la plantilla vigente de su tipo (no por el meta-agente ni por una versión anterior). */
export function estaAlDia(agent: Pick<Agent, 'tipoAsistente' | 'model' | 'templateVersion'>): boolean {
  return agent.model === null && agent.templateVersion === versionVigente(agent);
}

/** Los tipos de turno guardados, si tienen la forma que espera la plantilla. */
export function tiposEventoValidos(valor: Prisma.JsonValue): TipoEventoDto[] | null {
  if (!Array.isArray(valor) || valor.length === 0) return null;
  const tipos: TipoEventoDto[] = [];
  for (const item of valor) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const { nombre, duracionMin, precio } = item as Record<string, unknown>;
    if (typeof nombre !== 'string' || !nombre.trim()) return null;
    if (typeof duracionMin !== 'number' || !Number.isInteger(duracionMin) || duracionMin <= 0) return null;
    if (precio !== undefined && precio !== null && (typeof precio !== 'number' || !Number.isFinite(precio))) return null;
    tipos.push({ nombre: nombre.trim(), duracionMin, ...(typeof precio === 'number' ? { precio } : {}) });
  }
  return tipos;
}

/** Lo que hay que escribir para que el agente quede en la plantilla vigente. */
export function configuracionVigente(agent: FilaAgente): Regeneracion {
  const nombreTitular = agent.nombreTitular.trim();
  const nombreBot = agent.nombreBot.trim();
  if (!nombreTitular || !nombreBot) return { ok: false, motivo: 'sin nombre del titular o del asistente' };

  if (tipoAsistenteDe(agent) === 'ventas') {
    const config = construirConfiguracionVentas({ nombreTitular, nombreBot });
    return {
      ok: true,
      data: {
        systemPrompt: config.systemPrompt,
        allowedActions: config.allowedActions,
        descripcion: construirDescripcionVentas(nombreTitular, nombreBot),
        model: null,
        templateVersion: PLANTILLA_VENTAS_VERSION,
      },
    };
  }

  const tiposEvento = tiposEventoValidos(agent.tiposEvento);
  if (!tiposEvento) return { ok: false, motivo: 'tipos de turno vacíos o con otra forma' };
  const dto: GenerateAgentDto = {
    // La fila guarda strings; sus valores salieron del mismo catálogo (igual que actualizarTiposEvento).
    tipoTitular: agent.tipoTitular as TipoTitular,
    nombreTitular,
    tipoUso: agent.tipoUso as TipoUso,
    tiposEvento,
    horaDesde: agent.horaDesde,
    horaHasta: agent.horaHasta,
    nombreBot,
  };
  const config = construirConfiguracion(dto);
  return {
    ok: true,
    data: {
      systemPrompt: config.systemPrompt,
      allowedActions: config.allowedActions,
      descripcion: construirDescripcion(dto),
      model: null,
      templateVersion: PLANTILLA_VERSION,
    },
  };
}
