"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DIAS_SEMANA,
  horariosDe,
  problemaDelDia,
  type DiaEnPantalla,
  type DiaSemana,
  type FranjaLocal,
  type SemanaEnPantalla,
} from "@/lib/local";

function laMasTarde(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b;
}

function laMasTemprana(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b;
}

type Franjas = DiaEnPantalla["franjas"];

/** El corte del mediodía: parte la franja en dos, de mañana y de tarde. */
export function conCorte([primera]: Franjas): Franjas {
  // "HH:MM" se ordena bien como texto: la mañana cierra a las 13 y la tarde abre a las 16, dentro de la franja.
  return [
    { desde: primera.desde, hasta: laMasTarde(primera.desde, "13:00") },
    { desde: laMasTemprana(primera.hasta, "16:00"), hasta: primera.hasta },
  ];
}

export function sinCorte([primera, segunda]: Franjas): Franjas {
  return [{ desde: primera.desde, hasta: segunda?.hasta ?? primera.hasta }];
}

/**
 * Una semana de franjas en pantalla: los horarios del local de un comercio y
 * el horario de atención del asistente (LAU-29) usan los mismos controles
 * (EditorSemana) sobre este estado. `tocada` dice si la persona ya la editó,
 * para no pisarle lo que eligió al precargarla. Con `nocturnas` (el horario de
 * atención) una franja puede terminar al día siguiente: de 19:00 a 07:00.
 */
export function useSemana(inicial: () => SemanaEnPantalla, { nocturnas = false } = {}) {
  const [semana, setSemana] = useState<SemanaEnPantalla>(inicial);
  const [tocada, setTocada] = useState(false);

  const editar = useCallback((cambio: (previa: SemanaEnPantalla) => SemanaEnPantalla) => {
    setTocada(true);
    setSemana(cambio);
  }, []);

  const alternarDia = useCallback(
    (dia: DiaSemana) => editar((previa) => ({ ...previa, [dia]: { ...previa[dia], abierto: !previa[dia].abierto } })),
    [editar],
  );

  const fijarHora = useCallback(
    (dia: DiaSemana, indice: number, campo: "desde" | "hasta", hora: string) =>
      editar((previa) => ({
        ...previa,
        [dia]: {
          ...previa[dia],
          franjas: previa[dia].franjas.map((franja, i) => (i === indice ? { ...franja, [campo]: hora } : franja)),
        },
      })),
    [editar],
  );

  const agregarCorte = useCallback(
    (dia: DiaSemana) =>
      editar((previa) => ({ ...previa, [dia]: { ...previa[dia], franjas: conCorte(previa[dia].franjas) } })),
    [editar],
  );

  const quitarCorte = useCallback(
    (dia: DiaSemana) =>
      editar((previa) => ({ ...previa, [dia]: { ...previa[dia], franjas: sinCorte(previa[dia].franjas) } })),
    [editar],
  );

  /** Cambia varios días de una vez: un horario típico o el horario general de la carga rápida. */
  const fijarDias = useCallback(
    (cambios: Partial<SemanaEnPantalla>) => editar((previa) => ({ ...previa, ...cambios })),
    [editar],
  );

  /** Copia el horario de un día a los demás días que abren. */
  const copiarATodos = useCallback(
    (origen: DiaSemana) =>
      editar(
        (previa) =>
          Object.fromEntries(
            DIAS_SEMANA.map((dia) => [
              dia,
              previa[dia].abierto
                ? { ...previa[dia], franjas: previa[origen].franjas.map((franja) => ({ ...franja })) }
                : previa[dia],
            ]),
          ) as SemanaEnPantalla,
      ),
    [editar],
  );

  /** Reemplaza la semana sin marcarla como editada (una precarga). */
  const precargar = useCallback((nueva: SemanaEnPantalla) => setSemana(nueva), []);

  const problemas = useMemo(
    () =>
      Object.fromEntries(
        DIAS_SEMANA.map((dia, i) => [
          dia,
          problemaDelDia(semana[dia], {
            nocturnas,
            anterior: semana[DIAS_SEMANA[(i + DIAS_SEMANA.length - 1) % DIAS_SEMANA.length]],
          }),
        ]),
      ) as Record<DiaSemana, string | null>,
    [semana, nocturnas],
  );
  const valida = DIAS_SEMANA.every((dia) => !problemas[dia]);
  const franjas = useCallback((): FranjaLocal[] => horariosDe(semana), [semana]);

  return {
    semana,
    nocturnas,
    tocada,
    alternarDia,
    fijarHora,
    agregarCorte,
    quitarCorte,
    copiarATodos,
    fijarDias,
    precargar,
    problemas,
    valida,
    franjas,
  };
}

export type SemanaState = ReturnType<typeof useSemana>;
