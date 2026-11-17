/**
 * Por dónde sale lo que el asistente (o el dueño desde el panel) le manda a
 * un cliente. Hay dos: la sesión de Baileys (vinculación por QR o código, no
 * oficial) y la Cloud API de Meta. La canalización de atención de
 * WhatsappService no sabe cuál es.
 */
export type Salida = {
  canal: 'baileys' | 'meta';
  /**
   * Meta sólo deja escribir texto libre dentro de las 24 h del último
   * mensaje del cliente; fuera de esa ventana hacen falta plantillas, que
   * Trato no usa. Las respuestas del asistente siempre caen adentro.
   */
  ventana24h: boolean;
  enviarTexto(remoteJid: string, texto: string): Promise<void>;
  enviarImagen(remoteJid: string, jpeg: Buffer, leyenda: string): Promise<void>;
  /** "Escribiendo…" mientras se arma la respuesta. Nunca falla: es cosmético. */
  escribiendo(remoteJid: string): { renovar: () => void; parar: () => void };
  /** false si la conexión por la que llegó el mensaje ya se cerró o se reemplazó: no se contesta por ella. */
  vigente(): boolean;
};

/** El panel no pudo mandar porque pasaron más de 24 h desde el último mensaje del cliente (Cloud API). */
export class FueraDeVentanaError extends Error {
  constructor() {
    super('Pasaron más de 24 h desde el último mensaje del cliente.');
  }
}

export const VENTANA_META_MS = 24 * 60 * 60 * 1000;
