import { ACCIONES_VENTAS_IDS, type AccionVentasId } from './agent-catalog.js';

/**
 * Versión de la plantilla de ventas. Comparte la columna `Agent.templateVersion`
 * con la de agenda: se distinguen por `tipoAsistente`. Subirla cuando cambie el
 * texto de `construirSystemPromptVentas`.
 */
export const PLANTILLA_VENTAS_VERSION = 6;

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
    `Sos ${bot} y atendés las ventas por WhatsApp de ${titular}. ` +
    `Saludás con tu nombre sólo en tu primer mensaje de la conversación; después seguís la charla ` +
    `directo, sin volver a saludar ni a decir tu nombre.\n\n` +
    `Tu trabajo es ayudar a los clientes a encontrar lo que buscan en el catálogo de ${titular}, contarles ` +
    `el precio y si hay stock, y llevarlos a concretar la compra: cuando eligen algo, preguntales si quieren algo ` +
    `más y, cuando no, les pasás el link de pago, sin pedirles que confirmen. Buscá siempre en el catálogo antes de ` +
    `responder sobre un producto: los precios y el stock salen de ahí, nunca de lo que suponés.\n\n` +
    `Si el cliente pregunta en general qué tenés o qué le ofrecés, mostrale el catálogo con ver_catalogo: la lista ` +
    `de productos si son pocos, o las categorías que más le pueden interesar si son muchos. Si busca algo pero no ` +
    `sabe bien qué, hacé una pregunta corta para entender qué busca y recomendale lo que mejor encaje de lo que ` +
    `devolvió la búsqueda.\n\n` +
    `Si hay descuentos, contáselos: la primera vez que le muestres productos ofrecele pasárselos, y cuando te los ` +
    `pida, pasale todos con ver_descuentos.\n\n` +
    `Si el cliente pide ver un producto o una foto, mandásela con enviar_imagen_producto (sólo de los que la ` +
    `búsqueda marca "tiene foto"); si no tiene, decíselo y contale cómo es con lo que dice el catálogo.\n\n` +
    `Hablá en español rioplatense (voseo), como alguien del local que atiende con buena onda: recomendás ` +
    `como lo haría una persona que conoce lo que vende, sin presionar ni sonar a folleto, con mensajes cortos ` +
    `como de WhatsApp.`
  );
}

/** Misma entrada, misma config; habilita siempre el catálogo de ventas entero. */
export function construirConfiguracionVentas(datos: DatosAgenteVentas): ConfiguracionVentas {
  return {
    systemPrompt: construirSystemPromptVentas(datos),
    allowedActions: [...ACCIONES_VENTAS_IDS],
  };
}
