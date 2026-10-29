/**
 * Horario de atención del asistente (LAU-29): cuándo empieza a atender chats
 * nuevos por WhatsApp. Es de la cuenta (`User`), igual para agenda y ventas, y
 * se lee en la zona horaria que eligió el dueño, con sus cambios de horario de
 * verano incluidos (Intl resuelve el offset de cada instante).
 *
 * Todo acá es puro, igual que agents/local.ts, de donde salen la forma de las
 * franjas y sus validaciones: lo usan el endpoint que lo guarda, el filtro de
 * mensajes de WhatsApp y el estado que muestra el header.
 */
import type { Prisma, User } from '../generated/prisma/client.js';
import {
  estadoDelLocal,
  esDia,
  ordenar,
  problemaDeHorarios,
  resumenHorarios,
  type DiaSemana,
  type FranjaLocal,
} from '../agents/local.js';

export const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';

/**
 * Las zonas que ofrece la pantalla. Lista cerrada y no cualquier IANA: es lo
 * que la web muestra con nombre, y lo que no está acá no se guarda. Mantener
 * sincronizada con web/src/lib/horario-atencion.ts.
 */
export const ZONAS_HORARIAS = [
  { zona: 'America/Argentina/Buenos_Aires', nombre: 'Argentina' },
  { zona: 'America/Montevideo', nombre: 'Uruguay' },
  { zona: 'America/Santiago', nombre: 'Chile' },
  { zona: 'America/Asuncion', nombre: 'Paraguay' },
  { zona: 'America/La_Paz', nombre: 'Bolivia' },
  { zona: 'America/Sao_Paulo', nombre: 'Brasil (Brasilia)' },
  { zona: 'America/Lima', nombre: 'Perú' },
  { zona: 'America/Bogota', nombre: 'Colombia' },
  { zona: 'America/Guayaquil', nombre: 'Ecuador' },
  { zona: 'America/Caracas', nombre: 'Venezuela' },
  { zona: 'America/Mexico_City', nombre: 'México (centro)' },
  { zona: 'America/New_York', nombre: 'Estados Unidos (este)' },
  { zona: 'Europe/Madrid', nombre: 'España' },
] as const;
export type ZonaHoraria = (typeof ZONAS_HORARIAS)[number]['zona'];

export function esZonaHoraria(valor: unknown): valor is ZonaHoraria {
  return typeof valor === 'string' && ZONAS_HORARIAS.some((opcion) => opcion.zona === valor);
}

/**
 * Una conversación que tuvo un mensaje hace menos que esto sigue "en curso":
 * se termina de atender aunque haya cerrado el horario. Cuenta desde el último
 * mensaje, así que una charla activa sigue hasta que el cliente deja de escribir.
 */
export const GRACIA_EN_CURSO_MS = 30 * 60_000;

export type HorarioAtencion = {
  /** false = atiende siempre; las franjas quedan guardadas igual. */
  activo: boolean;
  franjas: FranjaLocal[];
  zona: ZonaHoraria;
};

/** Lo que manda la pantalla, ya con la forma validada por el DTO. */
export type HorarioAtencionEntrada = {
  activo: boolean;
  franjas: FranjaLocal[];
  zona: string;
};

/** Valida y normaliza. El error va tal cual en el 400. */
export function normalizarHorarioAtencion(
  entrada: HorarioAtencionEntrada,
): { horario: HorarioAtencion } | { error: string } {
  if (!esZonaHoraria(entrada.zona)) return { error: 'Elegí una zona horaria de la lista.' };
  const franjas = ordenar(entrada.franjas);
  // Atiende de noche: una franja puede terminar al día siguiente (de 19:00 a 07:00).
  const problema = problemaDeHorarios(franjas, { nocturnas: true });
  if (problema) return { error: problema };
  if (entrada.activo && franjas.length === 0) {
    return { error: 'Marcá al menos un día y horario en el que atienda el asistente.' };
  }
  return {
    horario: {
      activo: entrada.activo,
      franjas: franjas.map(({ dia, desde, hasta }) => ({ dia, desde, hasta })),
      zona: entrada.zona,
    },
  };
}

/**
 * Las columnas del usuario son Json y string libres: se validan antes de usar.
 * Lo que no se entiende atiende siempre, como una cuenta de antes de LAU-29:
 * un dato roto no puede dejar al negocio sin asistente en silencio.
 */
export function leerHorarioAtencion(
  user: Pick<User, 'horarioAtencionActivo' | 'horarioAtencion' | 'zonaHoraria'>,
): HorarioAtencion {
  const franjas = Array.isArray(user.horarioAtencion)
    ? user.horarioAtencion.flatMap((franja) =>
        typeof franja === 'object' &&
        franja !== null &&
        !Array.isArray(franja) &&
        esDia(franja.dia) &&
        typeof franja.desde === 'string' &&
        typeof franja.hasta === 'string'
          ? [{ dia: franja.dia, desde: franja.desde, hasta: franja.hasta }]
          : [],
      )
    : [];
  const resultado = normalizarHorarioAtencion({
    activo: user.horarioAtencionActivo,
    franjas,
    zona: user.zonaHoraria,
  });
  if ('horario' in resultado) return resultado.horario;
  return { activo: false, franjas: [], zona: ZONA_POR_DEFECTO };
}

/** Las columnas de `User` que guardan un horario ya normalizado. */
export function datosDelHorario(horario: HorarioAtencion): {
  horarioAtencionActivo: boolean;
  horarioAtencion: Prisma.InputJsonValue;
  zonaHoraria: string;
} {
  return {
    horarioAtencionActivo: horario.activo,
    horarioAtencion: horario.franjas as unknown as Prisma.InputJsonValue,
    zonaHoraria: horario.zona,
  };
}

/** Si a esta hora el horario deja atender chats nuevos. Sin restricción, siempre. */
export function dentroDelHorario(horario: HorarioAtencion, ahora: Date): boolean {
  return !horario.activo || estadoDelLocal(horario.franjas, ahora, horario.zona).abierto;
}

/** El horario en una línea, para la pantalla: "lunes a viernes de 09:00 a 18:00". */
export function resumenHorarioAtencion(horario: HorarioAtencion): string {
  return horario.activo ? resumenHorarios(horario.franjas) : 'Atiende siempre';
}

export type MotivoApagado = 'sin_whatsapp' | 'suscripcion_vencida' | 'fuera_de_horario';

/** Lo que muestra el header: si el asistente está contestando ahora y por qué no. */
export type EstadoAsistente = {
  prendido: boolean;
  motivo: MotivoApagado | null;
  /** Prendido por horario: hasta qué hora "HH:MM" de hoy. Ausente si atiende siempre. */
  hasta?: string;
  /** Fuera de horario: cuándo vuelve. `enDias`: 0 = hoy, 1 = mañana, 2 a 7 = ese día. */
  vuelve?: { dia: DiaSemana; desde: string; enDias: number };
  zona: ZonaHoraria;
};

/**
 * Combina lo que apaga al asistente, en el orden en que el dueño lo puede
 * arreglar: sin WhatsApp no hay nada que mirar; con la suscripción vencida el
 * horario no importa.
 */
export function estadoDelAsistente(entrada: {
  vinculado: boolean;
  suscripcionActiva: boolean;
  horario: HorarioAtencion;
  ahora: Date;
}): EstadoAsistente {
  const { horario } = entrada;
  const zona = horario.zona;
  if (!entrada.vinculado) return { prendido: false, motivo: 'sin_whatsapp', zona };
  if (!entrada.suscripcionActiva) return { prendido: false, motivo: 'suscripcion_vencida', zona };
  if (!horario.activo) return { prendido: true, motivo: null, zona };

  const estado = estadoDelLocal(horario.franjas, entrada.ahora, zona);
  if (estado.abierto) return { prendido: true, motivo: null, hasta: estado.hasta, zona };
  return {
    prendido: false,
    motivo: 'fuera_de_horario',
    ...(estado.abre ? { vuelve: estado.abre } : {}),
    zona,
  };
}
