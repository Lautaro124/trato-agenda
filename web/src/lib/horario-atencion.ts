/**
 * Horario de atención del asistente (LAU-29), del lado de la pantalla. La
 * forma y las zonas son las de api/src/horario-atencion/horario-atencion.rules.ts:
 * si se desincronizan, la API responde 400.
 */
import { NOMBRE_DIA, type DiaSemana, type FranjaLocal } from "./local";

export const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires";

export const ZONAS_HORARIAS = [
  { zona: "America/Argentina/Buenos_Aires", nombre: "Argentina" },
  { zona: "America/Montevideo", nombre: "Uruguay" },
  { zona: "America/Santiago", nombre: "Chile" },
  { zona: "America/Asuncion", nombre: "Paraguay" },
  { zona: "America/La_Paz", nombre: "Bolivia" },
  { zona: "America/Sao_Paulo", nombre: "Brasil (Brasilia)" },
  { zona: "America/Lima", nombre: "Perú" },
  { zona: "America/Bogota", nombre: "Colombia" },
  { zona: "America/Guayaquil", nombre: "Ecuador" },
  { zona: "America/Caracas", nombre: "Venezuela" },
  { zona: "America/Mexico_City", nombre: "México (centro)" },
  { zona: "America/New_York", nombre: "Estados Unidos (este)" },
  { zona: "Europe/Madrid", nombre: "España" },
] as const;

export function nombreDeZona(zona: string): string {
  return ZONAS_HORARIAS.find((opcion) => opcion.zona === zona)?.nombre ?? zona;
}

/**
 * Cada media hora del día, más 23:59 para poder atender hasta la medianoche
 * en una franja de todo el día (la API no acepta 24:00; una que termina antes de
 * empezar, como 19:00 a 07:00, sigue al día siguiente).
 */
export const HORAS_ATENCION = [
  ...Array.from({ length: 48 }, (_, i) => {
    const minutos = i * 30;
    return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  }),
  "23:59",
];

/** Los horarios típicos que se cargan de un toque en el onboarding. */
export const HORARIOS_TIPICOS: ReadonlyArray<{ etiqueta: string; dias: readonly DiaSemana[]; desde: string; hasta: string }> = [
  { etiqueta: "Lunes a viernes", dias: ["lun", "mar", "mie", "jue", "vie"], desde: "09:00", hasta: "18:00" },
  { etiqueta: "Lunes a sábado", dias: ["lun", "mar", "mie", "jue", "vie", "sab"], desde: "09:00", hasta: "20:00" },
  { etiqueta: "Todos los días", dias: ["lun", "mar", "mie", "jue", "vie", "sab", "dom"], desde: "09:00", hasta: "21:00" },
];

/** Lo que devuelven `GET` y `PUT /horario-atencion`. */
export type HorarioAtencion = {
  /** false = atiende siempre; las franjas quedan guardadas igual. */
  activo: boolean;
  franjas: FranjaLocal[];
  zona: string;
  resumen: string;
};

/** Lo que devuelve `GET /asistente/estado`, para el header. */
export type EstadoAsistente = {
  prendido: boolean;
  motivo: "sin_whatsapp" | "suscripcion_vencida" | "fuera_de_horario" | null;
  hasta?: string;
  vuelve?: { dia: DiaSemana; desde: string; enDias: number };
  zona: string;
};

/** "hoy a las 09:00", "mañana a las 09:00", "el lunes a las 09:00". */
export function textoVuelve(vuelve: NonNullable<EstadoAsistente["vuelve"]>): string {
  let cuando = `el ${NOMBRE_DIA[vuelve.dia].toLowerCase()}`;
  if (vuelve.enDias === 0) cuando = "hoy";
  else if (vuelve.enDias === 1) cuando = "mañana";
  return `${cuando} a las ${vuelve.desde}`;
}
