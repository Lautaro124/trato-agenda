/** Respuestas fijas del runtime, compartidas por el servicio y los nodos del grafo. */
export const MENSAJE_SIN_AGENTE =
  'Este número todavía no está configurado. Avisale al dueño que complete el alta.';
export const MENSAJE_DISCULPA_GENERICO =
  'Perdón, tuve un problema para responderte recién. ¿Me escribís de nuevo en un ratito?';
/** Cuando el proveedor del modelo rechaza el mensaje por moderación: no invita a reintentar. */
export const MENSAJE_FUERA_DE_ALCANCE =
  'Con eso no te puedo ayudar. Si querés, seguimos con lo que necesitás.';
export const MENSAJE_LOOP_AGOTADO = 'Dejame confirmarlo con más calma y te aviso enseguida.';
export const MENSAJE_SIN_RESPUESTA = '¿Podés repetirlo? No llegué a entenderlo bien.';
export const MENSAJE_CALENDAR_CAIDO =
  'No pude acceder a la agenda de Google Calendar ahora mismo. Avisale al dueño del negocio.';

/** Sólo se ve en el banco de pruebas del Home: quien lee es el dueño, no un cliente. */
export const MENSAJE_SUSCRIPCION_VENCIDA =
  'Se terminó tu mes de prueba, así que el asistente dejó de responder por WhatsApp. Activá el plan y vuelve a andar al toque.';

/** Cuando el asistente de ventas insiste con un precio que no sale del catálogo: mejor preguntar que inventar. */
export const MENSAJE_PRECIO_SIN_VERIFICAR =
  'No quiero pasarte un dato equivocado. ¿Me decís de nuevo qué producto buscás así lo reviso en el catálogo?';
