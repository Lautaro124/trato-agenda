/**
 * Reglas del mes de prueba y de la suscripción, como funciones puras y sin I/O
 * — mismo criterio que conversation/graph/agenda-rules.ts: la regla vive en
 * código, no en la base ni en un prompt, así aplica también a los usuarios que
 * se registraron antes de que existiera el cobro.
 */

/** Días de prueba gratis, contados desde que la persona entró con Google. */
export const DIAS_PRUEBA = 30;

/** Desde cuántos días restantes el aviso pasa de informativo a urgente. */
export const DIAS_AVISO = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * "activa": está pagando. "prueba": le sobran días. "por_vencer": está en los
 * últimos DIAS_AVISO días. "vencida": se le terminó el mes y no pagó.
 */
export type EstadoNombre = 'activa' | 'prueba' | 'por_vencer' | 'vencida';

export type EstadoSuscripcion = {
  estado: EstadoNombre;
  /** Días enteros que faltan para que termine la prueba; 0 si ya terminó o si paga. */
  diasRestantes: number;
  pruebaHasta: Date;
  /** Único booleano que mira el runtime de WhatsApp. */
  asistenteActivo: boolean;
};

/** Sólo lo que las reglas necesitan de la fila Subscription. */
export type SuscripcionMinima = { estado: string } | null;

export function finDePrueba(creadoEl: Date): Date {
  return new Date(creadoEl.getTime() + DIAS_PRUEBA * MS_POR_DIA);
}

/**
 * Una suscripción "activa" gana sobre cualquier cosa de la prueba; sin ella,
 * se compara `ahora` contra el fin de la prueba.
 */
export function estadoDeSuscripcion(entrada: {
  creadoEl: Date;
  suscripcion: SuscripcionMinima;
  ahora?: Date;
}): EstadoSuscripcion {
  const ahora = entrada.ahora ?? new Date();
  const pruebaHasta = finDePrueba(entrada.creadoEl);

  if (entrada.suscripcion?.estado === 'activa') {
    return { estado: 'activa', diasRestantes: 0, pruebaHasta, asistenteActivo: true };
  }

  const msRestantes = pruebaHasta.getTime() - ahora.getTime();
  if (msRestantes <= 0) {
    return { estado: 'vencida', diasRestantes: 0, pruebaHasta, asistenteActivo: false };
  }

  // Redondeo hacia arriba: quedando 30 minutos, el aviso dice "1 día", no "0".
  const diasRestantes = Math.ceil(msRestantes / MS_POR_DIA);
  return {
    estado: diasRestantes <= DIAS_AVISO ? 'por_vencer' : 'prueba',
    diasRestantes,
    pruebaHasta,
    asistenteActivo: true,
  };
}
