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
  type OpcionLugar,
  type SemanaEnPantalla,
  type TipoLugar,
} from "@/lib/local";

function laMasTarde(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b;
}

function laMasTemprana(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b;
}

const RESUMEN_LUGAR: Record<OpcionLugar, string> = {
  local: "En un local",
  casa: "En tu casa",
  ninguno: "Sin lugar fijo",
};

/**
 * El lugar donde se atiende. Lo usan el paso "Tu local" (ventas) o "Dónde
 * atendés" (turnos, `paraAgenda`) de /contanos y la sección de /cuenta, que
 * muestran los mismos controles sobre el mismo estado (igual que
 * useTiposEvento con /reuniones). En turnos no hay horarios ni retiro: cuándo
 * atiende ya lo dicen la franja y las clases; sí la dirección, obligatoria.
 */
export function useLocal(inicial: LocalPresencial | null = null, { paraAgenda = false }: { paraAgenda?: boolean } = {}) {
  // Turnos arranca en "local": es la respuesta más común y el paso queda listo con sólo escribir la dirección.
  const [tieneLocal, setTieneLocal] = useState(inicial?.tieneLocal ?? paraAgenda);
  const [lugar, setLugar] = useState<TipoLugar>(inicial?.lugar ?? "local");
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
      // "HH:MM" se ordena bien como texto: la mañana cierra a las 13 y la tarde abre a las 16, dentro de la franja.
      const manana = { desde: primera.desde, hasta: laMasTarde(primera.desde, "13:00") };
      const tarde = { desde: laMasTemprana(primera.hasta, "16:00"), hasta: primera.hasta };
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

  const opcionLugar: OpcionLugar = tieneLocal ? lugar : "ninguno";
  const elegirOpcionLugar = useCallback((opcion: OpcionLugar) => {
    setTieneLocal(opcion !== "ninguno");
    if (opcion !== "ninguno") setLugar(opcion);
  }, []);

  const problemas = useMemo(
    () => ({
      direccion: problemaDeLaDireccion(direccion, paraAgenda),
      enlace: problemaDelEnlace(enlaceUbicacion),
      dias: Object.fromEntries(DIAS_SEMANA.map((dia) => [dia, problemaDelDia(semana[dia])])) as Record<
        DiaSemana,
        string | null
      >,
    }),
    [direccion, enlaceUbicacion, semana, paraAgenda],
  );

  const valido =
    !tieneLocal ||
    (!problemas.direccion &&
      !problemas.enlace &&
      (paraAgenda || DIAS_SEMANA.every((dia) => !problemas.dias[dia])));

  /**
   * Body de `local` en POST /agents/generate, POST /agents/generate-ventas y
   * PUT /agents/me/local. Lo vacío no viaja.
   */
  const payload = useCallback((): LocalPresencial => {
    if (!tieneLocal) return { tieneLocal: false, horarios: [], retiroEnLocal: false };
    const direccionLimpia = direccion.trim();
    const enlaceLimpio = enlaceUbicacion.trim();
    if (paraAgenda) {
      return {
        tieneLocal: true,
        lugar,
        direccion: direccionLimpia,
        ...(enlaceLimpio ? { enlaceUbicacion: enlaceLimpio } : {}),
        horarios: [],
        retiroEnLocal: false,
      };
    }
    return {
      tieneLocal: true,
      ...(direccionLimpia ? { direccion: direccionLimpia } : {}),
      ...(enlaceLimpio ? { enlaceUbicacion: enlaceLimpio } : {}),
      horarios: horariosDe(semana),
      retiroEnLocal,
    };
  }, [tieneLocal, direccion, enlaceUbicacion, semana, retiroEnLocal, paraAgenda, lugar]);

  const resumen = paraAgenda
    ? RESUMEN_LUGAR[opcionLugar]
    : tieneLocal
      ? direccion.trim() || "Con local"
      : "Sólo online";

  return {
    tieneLocal,
    setTieneLocal,
    opcionLugar,
    elegirOpcionLugar,
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
    resumen,
  };
}

export type LocalState = ReturnType<typeof useLocal>;
