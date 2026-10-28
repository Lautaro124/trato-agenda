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

/** Planes pagos. El Básico es el que ya existía; el Pro sube el tope de chats. */
export const PLANES = {
  basico: { nombre: 'Básico', chats: 1500 },
  pro: { nombre: 'Pro', chats: 4500 },
} as const;

export type PlanId = keyof typeof PLANES;

export const IDS_DE_PLAN = Object.keys(PLANES) as PlanId[];

/** Desde qué porcentaje del tope se avisa que se está llegando. */
export const PORCENTAJE_AVISO_CUPO = 80;

export function esPlanId(valor: unknown): valor is PlanId {
  return typeof valor === 'string' && Object.hasOwn(PLANES, valor);
}

/**
 * Durante la prueba (sin plan elegido) se muestra el tope del Pro: el mes
 * gratis incluye todo. Un valor desconocido en la base cuenta como Básico.
 */
export function limiteDeChats(plan: string | null | undefined): number {
  if (plan === null || plan === undefined) return PLANES.pro.chats;
  return esPlanId(plan) ? PLANES[plan].chats : PLANES.basico.chats;
}

/**
 * El plan que se está pagando, o null: sólo una suscripción `activa` tiene
 * plan (la prueba, una vencida o una pendiente no). Un valor desconocido en la
 * base cuenta como Básico, igual que en `limiteDeChats`.
 */
export function planVigente(estado: Pick<EstadoSuscripcion, 'estado'>, plan: string | null | undefined): PlanId | null {
  if (estado.estado !== 'activa' || plan === null || plan === undefined) return null;
  return esPlanId(plan) ? plan : 'basico';
}

/**
 * Lo que cada plan habilita además del tope de chats. La importación rápida
 * de productos (LAU-31) es sólo del Pro pagando: el mes de prueba no la trae.
 */
export type FuncionesDelPlan = { importacionRapida: boolean };

export function funcionesDelPlan(plan: PlanId | null): FuncionesDelPlan {
  return { importacionRapida: plan === 'pro' };
}

export type EstadoDeCupo = {
  usados: number;
  limite: number;
  restantes: number;
  porcentaje: number;
  /** Llegó al PORCENTAJE_AVISO_CUPO del tope. */
  cercano: boolean;
  /** Alcanzó o pasó el tope. Sólo se avisa: el asistente sigue contestando. */
  superado: boolean;
};

/** "Chat" = cliente distinto con mensajes en el mes; acá sólo se compara el número con el tope. */
export function estadoDeCupo(entrada: { usados: number; plan: string | null | undefined }): EstadoDeCupo {
  const limite = limiteDeChats(entrada.plan);
  const usados = Math.max(0, Math.floor(entrada.usados));
  const porcentaje = Math.floor((usados * 100) / limite);
  return {
    usados,
    limite,
    restantes: Math.max(0, limite - usados),
    porcentaje,
    cercano: porcentaje >= PORCENTAJE_AVISO_CUPO,
    superado: usados >= limite,
  };
}

/** Buenos Aires no tiene horario de verano: el desfase es fijo (UTC-3). */
const DESFASE_HORAS_AR = 3;

/**
 * Mes calendario en hora argentina que contiene a `ahora`: [desde, hasta) y su
 * etiqueta AAAA-MM, que sirve de clave para avisar una sola vez por mes.
 */
export function rangoDelMes(ahora: Date): { desde: Date; hasta: Date; etiqueta: string } {
  const local = new Date(ahora.getTime() - DESFASE_HORAS_AR * 60 * 60 * 1000);
  const anio = local.getUTCFullYear();
  const mes = local.getUTCMonth();
  return {
    desde: new Date(Date.UTC(anio, mes, 1, DESFASE_HORAS_AR)),
    hasta: new Date(Date.UTC(anio, mes + 1, 1, DESFASE_HORAS_AR)),
    etiqueta: `${anio}-${String(mes + 1).padStart(2, '0')}`,
  };
}
