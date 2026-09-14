import { ACCIONES_IDS, type AccionId } from './agent-catalog.js';
import type { GenerateAgentDto } from './agents.types.js';

/**
 * Versión de la plantilla determinista: subir cuando cambie el texto que
 * genera `construirSystemPrompt`, para poder distinguir con qué versión se
 * generó cada `Agent.templateVersion` ya persistido.
 */
export const PLANTILLA_VERSION = 1;

export type ConfiguracionAgente = { systemPrompt: string; allowedActions: AccionId[] };

function listarTiposEvento(dto: GenerateAgentDto): string {
  return dto.tiposEvento
    .map((tipo) => `${JSON.stringify(tipo.nombre.trim())} (${tipo.duracionMin} min)`)
    .join(', ');
}

/**
 * Arma el system prompt del agente sin llamar a ningún LLM. No repite las
 * reglas que el runtime ya agrega en código (cargar-contexto.node.ts: reglas
 * de agenda, de alcance, de estilo y disponibilidad) — sólo cubre lo que
 * antes le tocaba redactar al meta-agente: presentación, contexto del
 * negocio, tipos de turno y tono.
 *
 * Los valores de texto libre del usuario (nombreTitular, nombreBot, nombre
 * de cada tipo de turno) se serializan con `JSON.stringify`: los delimita y
 * escapa comillas/saltos de línea de forma inequívoca frente al resto del
 * prompt, para que el modelo los lea como dato y no como instrucción. Esto
 * reduce la ambigüedad instrucción/dato, pero no es una garantía contra
 * prompt injection.
 */
function construirSystemPrompt(dto: GenerateAgentDto): string {
  const titular = JSON.stringify(dto.nombreTitular.trim());
  const bot = JSON.stringify(dto.nombreBot.trim());
  const quien = dto.tipoTitular === 'persona' ? 'una persona' : 'un negocio';

  return (
    `Sos ${bot}, el asistente de WhatsApp de ${titular} (${quien}, tipo de uso: ${dto.tipoUso}). ` +
    `Te presentás como el asistente de ${titular} apenas arranca la charla.\n\n` +
    `Atendé de lunes a viernes de ${dto.horaDesde} a ${dto.horaHasta}. ` +
    `Tipos de turno que se pueden agendar, con su duración: ${listarTiposEvento(dto)}.\n\n` +
    `Antes de agendar, preguntá los datos que falten (día, horario, tipo de turno y nombre de la ` +
    `persona) si no te los dijeron. Consultá disponibilidad antes de ofrecer un horario, y pedí ` +
    `confirmación explícita antes de crear, cancelar o reprogramar un turno.\n\n` +
    `Hablá únicamente de la agenda de ${titular}: no inventes precios, dirección ni otros datos del ` +
    `negocio que no te hayan dado acá, y derivá esas consultas a ${titular}.\n\n` +
    `Hablá en español rioplatense (voseo), en tono profesional y amable, con mensajes cortos como de ` +
    `WhatsApp.`
  );
}

/**
 * Reemplaza al meta-agente: misma entrada produce siempre la misma config,
 * sin llamadas de red. Las 5 acciones del catálogo se habilitan siempre —
 * son genéricas a cualquier tipoUso/tipoTitular, no hay regla de producto que
 * las diferencie hoy.
 */
export function construirConfiguracion(dto: GenerateAgentDto): ConfiguracionAgente {
  return {
    systemPrompt: construirSystemPrompt(dto),
    allowedActions: [...ACCIONES_IDS],
  };
}
