/**
 * Plazos de retención de datos, como funciones puras — misma idea que
 * `subscription/subscription.rules.ts`: la regla vive en un solo lugar, se
 * testea sin base de datos y es la que se publica en /privacidad.
 *
 * Lo que se borra es lo que tiene datos de terceros (los clientes que le
 * escriben al asistente y nunca aceptaron nada con nosotros): el texto de los
 * mensajes, el estado de la conversación en el checkpointer, el nombre y el
 * resumen. Los `Turno` se conservan mientras exista la cuenta: son el registro
 * de la agenda del titular.
 *
 * Si estos números cambian, hay que cambiar también la política de privacidad:
 * una vez publicados son un compromiso, no una preferencia.
 */

/** Conversación sin actividad: se le borra el historial de mensajes y su checkpoint. */
export const DIAS_RETENCION_MENSAJES = 90;

/** Más adelante se le borran también el nombre del cliente y el resumen. */
export const DIAS_RETENCION_DATOS_CLIENTE = 365;

export function fechaLimite(dias: number, ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
}
