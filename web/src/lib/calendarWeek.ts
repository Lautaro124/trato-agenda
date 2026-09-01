const TIMEZONE = "America/Argentina/Buenos_Aires";

/** Días de la semana que muestra la vista de calendario (lunes a sábado, sin domingo). */
export const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb"] as const;

/** Franja horaria de la grilla: cada hora ocupa 2 filas de 30 min. */
export const HORA_INICIO = 8;
export const HORA_FIN = 18;
export const FILAS_POR_HORA = 2;
export const TOTAL_FILAS = (HORA_FIN - HORA_INICIO) * FILAS_POR_HORA;

function diaSemanaEnBuenosAires(date: Date): number {
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(date);
  const offsets: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return offsets[nombre] ?? 0;
}

export function addDays(date: Date, dias: number): Date {
  return new Date(date.getTime() + dias * 24 * 60 * 60 * 1000);
}

/** Lunes 00:00 (Buenos Aires) de la semana que contiene `date`. */
export function mondayOf(date: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
  const inicioDelDia = new Date(`${ymd}T00:00:00-03:00`);
  return addDays(inicioDelDia, -diaSemanaEnBuenosAires(inicioDelDia));
}

/** Fecha en formato YYYY-MM-DD (Buenos Aires), para pasar como query param `desde`. */
export function isoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
}

export function formatMonthYear(date: Date): string {
  const texto = new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, month: "long", year: "numeric" }).format(
    date,
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatWeekLabel(weekStart: Date): string {
  const fin = addDays(weekStart, DIAS_SEMANA.length - 1);
  const formateador = new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, day: "numeric", month: "long" });
  return `Semana del ${formateador.format(weekStart)} al ${formateador.format(fin)}`;
}

export function formatDayNumber(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, day: "numeric" }).format(date);
}

/** Primer día (00:00 Buenos Aires) del mes que contiene `date`. */
export function firstDayOfMonth(date: Date): Date {
  const [anio, mes] = isoDate(date).split("-");
  return new Date(`${anio}-${mes}-01T00:00:00-03:00`);
}

/** Primer día del mes, `meses` meses antes/después del mes de `date`. */
export function addMonths(date: Date, meses: number): Date {
  const [anio, mes] = isoDate(firstDayOfMonth(date)).split("-").map(Number);
  const total = mes - 1 + meses;
  const nuevoAnio = anio + Math.floor(total / 12);
  const nuevoMes = ((total % 12) + 12) % 12;
  return new Date(`${nuevoAnio}-${String(nuevoMes + 1).padStart(2, "0")}-01T00:00:00-03:00`);
}

/** "Martes 1", para el header de la vista de un solo día. */
export function formatDayLabel(date: Date): string {
  const texto = new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, weekday: "long", day: "numeric" }).format(
    date,
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Hora HH:MM (Buenos Aires) de un ISO, para las etiquetas de la columna izquierda. */
export function formatHourLabel(hora: number): string {
  return `${String(hora).padStart(2, "0")}:00`;
}

/**
 * Posición de un evento en la grilla: fila de inicio (1-indexed, fila 1 = HORA_INICIO) y cantidad
 * de filas que ocupa. Devuelve null si el evento cae fuera de la franja 08:00-18:00.
 */
export function posicionEvento(
  inicioISO: string | null,
  finISO: string | null,
): { gridRowStart: number; gridRowSpan: number } | null {
  if (!inicioISO || !finISO) return null;
  const inicio = new Date(inicioISO);
  const fin = new Date(finISO);

  const minutosDesdeInicio = (date: Date) => {
    const horas = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(date),
    );
    const minutos = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, minute: "2-digit" }).format(date));
    return (horas - HORA_INICIO) * 60 + minutos;
  };

  const inicioMin = Math.max(0, minutosDesdeInicio(inicio));
  const finMin = Math.min(TOTAL_FILAS * 30, minutosDesdeInicio(fin));
  if (finMin <= 0 || inicioMin >= TOTAL_FILAS * 30 || finMin <= inicioMin) return null;

  const gridRowStart = Math.floor(inicioMin / 30) + 1;
  const gridRowSpan = Math.max(1, Math.ceil((finMin - inicioMin) / 30));
  return { gridRowStart, gridRowSpan };
}

/** Índice de columna (0 = lunes … 5 = sábado) de un evento, o null si cae fuera de la semana/domingo. */
export function columnaEvento(inicioISO: string | null, weekStart: Date): number | null {
  if (!inicioISO) return null;
  const dia = diaSemanaEnBuenosAires(new Date(inicioISO));
  const offsetDias = Math.round((mondayOf(new Date(inicioISO)).getTime() - weekStart.getTime()) / 86400000);
  if (offsetDias !== 0 || dia >= DIAS_SEMANA.length) return null;
  return dia;
}
