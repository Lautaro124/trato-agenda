/**
 * El local a la calle de un comercio, del lado de la pantalla. La forma es la
 * de `LocalPresencial` en api/src/agents/local.ts, y los límites también: si
 * se superan, la API responde 400.
 */

export const DIAS_SEMANA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

export const NOMBRE_DIA: Record<DiaSemana, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

export const LARGO_MIN_DIRECCION = 3;
export const LARGO_MAX_DIRECCION = 200;
export const LARGO_MAX_ENLACE = 500;

/** Cada media hora, de 06:00 a 23:30: el local no necesita la precisión de un turno. */
export const HORAS_LOCAL = Array.from({ length: 36 }, (_, i) => {
  const minutos = 6 * 60 + i * 30;
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
});

export type FranjaLocal = { dia: DiaSemana; desde: string; hasta: string };

/** Lo que devuelve `GET /agents/me` en `local` y lo que manda `PUT /agents/me/local`. */
export type LocalPresencial = {
  tieneLocal: boolean;
  direccion?: string;
  enlaceUbicacion?: string;
  horarios: FranjaLocal[];
  retiroEnLocal: boolean;
};

/** Un día en pantalla: si abre y sus franjas (una, o dos con el corte del mediodía). */
export type DiaEnPantalla = { abierto: boolean; franjas: Array<{ desde: string; hasta: string }> };
export type SemanaEnPantalla = Record<DiaSemana, DiaEnPantalla>;

/** Lunes a viernes de 09:00 a 18:00: con lo que arranca quien dice que tiene local. */
export function semanaInicial(): SemanaEnPantalla {
  return Object.fromEntries(
    DIAS_SEMANA.map((dia) => [
      dia,
      { abierto: dia !== "sab" && dia !== "dom", franjas: [{ desde: "09:00", hasta: "18:00" }] },
    ]),
  ) as SemanaEnPantalla;
}

/** Lo guardado, en la forma de la pantalla. Un local sin horarios arranca con la semana típica. */
export function semanaDesde(horarios: FranjaLocal[]): SemanaEnPantalla {
  if (horarios.length === 0) return semanaInicial();
  const semana = semanaInicial();
  for (const dia of DIAS_SEMANA) {
    const franjas = horarios
      .filter((franja) => franja.dia === dia)
      .map(({ desde, hasta }) => ({ desde, hasta }))
      .sort((a, b) => a.desde.localeCompare(b.desde));
    semana[dia] = franjas.length > 0 ? { abierto: true, franjas } : { ...semana[dia], abierto: false };
  }
  return semana;
}

export function horariosDe(semana: SemanaEnPantalla): FranjaLocal[] {
  return DIAS_SEMANA.flatMap((dia) =>
    semana[dia].abierto ? semana[dia].franjas.map(({ desde, hasta }) => ({ dia, desde, hasta })) : [],
  );
}

/** Por qué un día no se puede guardar, o null. Mismo criterio que normalizarLocal en la API. */
export function problemaDelDia(dia: DiaEnPantalla): string | null {
  if (!dia.abierto) return null;
  const [primera, segunda] = dia.franjas;
  if (primera.desde >= primera.hasta || (segunda && segunda.desde >= segunda.hasta)) {
    return "Tiene que cerrar después de abrir.";
  }
  if (segunda && segunda.desde < primera.hasta) return "La segunda franja tiene que empezar después de la primera.";
  return null;
}

export function problemaDelEnlace(enlace: string): string | null {
  const limpio = enlace.trim();
  if (!limpio) return null;
  try {
    if (new URL(limpio).protocol === "https:" && limpio.length <= LARGO_MAX_ENLACE) return null;
  } catch {
    // Cae al mensaje de abajo.
  }
  return "Pegá el link completo, que empiece con https://";
}

export function problemaDeLaDireccion(direccion: string): string | null {
  const limpia = direccion.trim();
  return limpia && limpia.length < LARGO_MIN_DIRECCION ? "La dirección es demasiado corta." : null;
}
