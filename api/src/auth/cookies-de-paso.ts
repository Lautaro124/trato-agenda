/**
 * Cookies cortas de los pasos intermedios. Van aparte de la de sesión y con
 * un JWT de `tipo` propio (ver `JwtPayload`), así ninguna vale por la otra.
 */

/** Alta por WhatsApp: del botón "Continuar con WhatsApp" hasta escanear el QR. */
export const COOKIE_ALTA = 'trato_alta';
export const SEGUNDOS_ALTA = 15 * 60;

/** Conectar Google a una cuenta existente: ida y vuelta del consentimiento. */
export const COOKIE_CONECTAR = 'trato_conectar';
export const SEGUNDOS_CONECTAR = 10 * 60;
