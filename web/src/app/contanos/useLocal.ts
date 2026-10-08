"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DIAS_SEMANA,
  horariosDe,
  problemaDeLaDireccion,
  problemaDelDia,
  problemaDelEnlace,
  semanaDesde,
  semanaInicial,
  type DiaSemana,
  type LocalPresencial,
  type SemanaEnPantalla,
} from "@/lib/local";

/**
 * El local a la calle de un comercio. Lo usan el paso "Tu local" de /contanos
 * y la sección de /cuenta, que muestran los mismos controles sobre el mismo
 * estado (igual que useTiposEvento con /reuniones).
 */
export function useLocal(inicial: LocalPresencial | null = null) {
  const [tieneLocal, setTieneLocal] = useState(inicial?.tieneLocal ?? false);
  const [direccion, setDireccion] = useState(inicial?.direccion ?? "");
  const [enlaceUbicacion, setEnlaceUbicacion] = useState(inicial?.enlaceUbicacion ?? "");
  const [retiroEnLocal, setRetiroEnLocal] = useState(inicial?.retiroEnLocal ?? false);
  const [semana, setSemana] = useState<SemanaEnPantalla>(() =>
    inicial?.tieneLocal ? semanaDesde(inicial.horarios) : semanaInicial(),
  );

  const alternarDia = useCallback((dia: DiaSemana) => {
    setSemana((previa) => ({ ...previa, [dia]: { ...previa[dia], abierto: !previa[dia].abierto } }));
  }, []);

  const fijarHora = useCallback((dia: DiaSemana, indice: number, campo: "desde" | "hasta", hora: string) => {
    setSemana((previa) => ({
      ...previa,
      [dia]: {
        ...previa[dia],
        franjas: previa[dia].franjas.map((franja, i) => (i === indice ? { ...franja, [campo]: hora } : franja)),
      },
    }));
  }, []);

  /** El corte del mediodía: parte la franja en dos, de mañana y de tarde. */
  const agregarCorte = useCallback((dia: DiaSemana) => {
    setSemana((previa) => {
      const [primera] = previa[dia].franjas;
      const manana = { desde: primera.desde, hasta: primera.desde < "13:00" ? "13:00" : primera.desde };
      const tarde = { desde: primera.hasta > "16:00" ? "16:00" : primera.hasta, hasta: primera.hasta };
      return { ...previa, [dia]: { ...previa[dia], franjas: [manana, tarde] } };
    });
  }, []);

  const quitarCorte = useCallback((dia: DiaSemana) => {
    setSemana((previa) => {
      const [primera, segunda] = previa[dia].franjas;
      const unida = { desde: primera.desde, hasta: segunda?.hasta ?? primera.hasta };
      return { ...previa, [dia]: { ...previa[dia], franjas: [unida] } };
    });
  }, []);

  /** Copia el horario de un día a los demás días que abren. */
  const copiarATodos = useCallback((origen: DiaSemana) => {
    setSemana((previa) =>
      Object.fromEntries(
        DIAS_SEMANA.map((dia) => [
          dia,
          previa[dia].abierto ? { ...previa[dia], franjas: previa[origen].franjas.map((franja) => ({ ...franja })) } : previa[dia],
        ]),
      ) as SemanaEnPantalla,
    );
  }, []);

  const problemas = useMemo(
    () => ({
      direccion: problemaDeLaDireccion(direccion),
      enlace: problemaDelEnlace(enlaceUbicacion),
      dias: Object.fromEntries(DIAS_SEMANA.map((dia) => [dia, problemaDelDia(semana[dia])])) as Record<
        DiaSemana,
        string | null
      >,
    }),
    [direccion, enlaceUbicacion, semana],
  );

  const valido =
    !tieneLocal ||
    (!problemas.direccion && !problemas.enlace && DIAS_SEMANA.every((dia) => !problemas.dias[dia]));

  /** Body de `local` en POST /agents/generate-ventas y PUT /agents/me/local. Lo vacío no viaja. */
  const payload = useCallback((): LocalPresencial => {
    if (!tieneLocal) return { tieneLocal: false, horarios: [], retiroEnLocal: false };
    const direccionLimpia = direccion.trim();
    const enlaceLimpio = enlaceUbicacion.trim();
    return {
      tieneLocal: true,
      ...(direccionLimpia ? { direccion: direccionLimpia } : {}),
      ...(enlaceLimpio ? { enlaceUbicacion: enlaceLimpio } : {}),
      horarios: horariosDe(semana),
      retiroEnLocal,
    };
  }, [tieneLocal, direccion, enlaceUbicacion, semana, retiroEnLocal]);

  return {
    tieneLocal,
    setTieneLocal,
    direccion,
    setDireccion,
    enlaceUbicacion,
    setEnlaceUbicacion,
    retiroEnLocal,
    setRetiroEnLocal,
    semana,
    alternarDia,
    fijarHora,
    agregarCorte,
    quitarCorte,
    copiarATodos,
    problemas,
    valido,
    payload,
    /** Para el riel del wizard. */
    resumen: tieneLocal ? direccion.trim() || "Con local" : "Sólo online",
  };
}

export type LocalState = ReturnType<typeof useLocal>;
