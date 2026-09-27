/**
 * Plazos de retención de datos, como funciones puras — misma idea que
 * `subscription/subscription.rules.ts`: la regla vive en un solo lugar, se
 * testea sin base de datos y es la que se publica en /privacidad.
 *
 * Lo que se borra es lo que tiene datos de terceros (los clientes que le
 * escriben al asistente y nunca aceptaron nada con nosotros): el texto de los
 * mensajes, el estado de la conversación en el checkpointer, el nombre y el
 * resumen. Los `Turno` se conservan mientras exista la cuenta: son el registro
 * de la agenda del titular. Con las `Venta` pasa lo mismo (son el histórico
 * del comercio), pero a los `DIAS_RETENCION_DATOS_CLIENTE` pierden el nombre y
 * el teléfono del cliente. Los avisos del panel también traen nombres y
 * consultas de clientes, así que tienen su propio plazo.
 *
 * Si estos números cambian, hay que cambiar también la política de privacidad:
 * una vez publicados son un compromiso, no una preferencia.
 */

/** Conversación sin actividad: se le borra el historial de mensajes y su checkpoint. */
export const DIAS_RETENCION_MENSAJES = 90;

/**
 * Más adelante se le borran también el nombre del cliente y el resumen, y a
 * las ventas el nombre y el teléfono del comprador.
 */
export const DIAS_RETENCION_DATOS_CLIENTE = 365;

/**
 * Avisos del panel ya leídos: cumplieron su función. Los que nadie leyó duran
 * lo mismo que los datos del cliente que llevan adentro.
 */
export const DIAS_RETENCION_AVISOS_LEIDOS = 90;

/**
 * Alta por WhatsApp que nunca escaneó el QR: un usuario sin Google ni
 * teléfono. No tiene datos de nadie, pero sí un socket y una fila; a la hora
 * se descarta (la cookie del alta vence a los 15 minutos).
 */
export const HORAS_ALTA_PENDIENTE = 1;

export function fechaLimiteHoras(horas: number, ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - horas * 60 * 60 * 1000);
}

export function fechaLimite(dias: number, ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
}
