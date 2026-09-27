import { ACCIONES_VENTAS_IDS, type AccionVentasId } from './agent-catalog.js';

/**
 * Versión de la plantilla de ventas. Comparte la columna `Agent.templateVersion`
 * con la de agenda: se distinguen por `tipoAsistente`. Subirla cuando cambie el
 * texto de `construirSystemPromptVentas`.
 */
export const PLANTILLA_VENTAS_VERSION = 1;

export type DatosAgenteVentas = { nombreTitular: string; nombreBot: string };

export type ConfiguracionVentas = { systemPrompt: string; allowedActions: AccionVentasId[] };

/**
 * System prompt del asistente de ventas, sin LLM, igual que la plantilla de
 * agenda. No repite las reglas que el runtime agrega en código en cada
 * mensaje (cargar-contexto-ventas.node.ts: reglas de venta, de alcance, de
 * estilo y el resumen del catálogo): sólo la presentación y el tono.
 *
 * Los textos libres del dueño van por `JSON.stringify` para que el modelo los
 * lea como dato y no como instrucción.
 */
function construirSystemPromptVentas(datos: DatosAgenteVentas): string {
  const titular = JSON.stringify(datos.nombreTitular.trim());
  const bot = JSON.stringify(datos.nombreBot.trim());

  return (
    `Sos ${bot}, el asistente de ventas por WhatsApp de ${titular}. ` +
    `Te presentás como el asistente de ${titular} apenas arranca la charla.\n\n` +
    `Tu trabajo es ayudar a los clientes a encontrar lo que buscan en el catálogo de ${titular}, contarles ` +
    `el precio y si hay stock, y llevarlos a concretar la compra. Buscá siempre en el catálogo antes de ` +
    `responder sobre un producto: los precios y el stock salen de ahí, nunca de lo que suponés.\n\n` +
    `Si el cliente no sabe bien qué quiere, hacé una pregunta corta para entender qué busca y recomendale ` +
    `lo que mejor encaje de lo que devolvió la búsqueda.\n\n` +
    `Hablá en español rioplatense (voseo), en tono amable y vendedor pero sin presionar, con mensajes ` +
    `cortos como de WhatsApp.`
  );
}

/** Misma entrada, misma config; habilita siempre el catálogo de ventas entero. */
export function construirConfiguracionVentas(datos: DatosAgenteVentas): ConfiguracionVentas {
  return {
    systemPrompt: construirSystemPromptVentas(datos),
    allowedActions: [...ACCIONES_VENTAS_IDS],
  };
}
