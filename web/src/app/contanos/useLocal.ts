"use client";

import { useCallback, useMemo, useState } from "react";
import {
  problemaDeLaDireccion,
  problemaDelEnlace,
  semanaDesde,
  semanaInicial,
  type LocalPresencial,
  type OpcionLugar,
  type TipoLugar,
} from "@/lib/local";
import { useSemana } from "./useSemana";

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
  const horarios = useSemana(() => (inicial?.tieneLocal ? semanaDesde(inicial.horarios) : semanaInicial()));

  const opcionLugar: OpcionLugar = tieneLocal ? lugar : "ninguno";
  const elegirOpcionLugar = useCallback((opcion: OpcionLugar) => {
    setTieneLocal(opcion !== "ninguno");
    if (opcion !== "ninguno") setLugar(opcion);
  }, []);

  const problemas = useMemo(
    () => ({
      direccion: problemaDeLaDireccion(direccion, paraAgenda),
      enlace: problemaDelEnlace(enlaceUbicacion),
    }),
    [direccion, enlaceUbicacion, paraAgenda],
  );

  const valido =
    !tieneLocal ||
    (!problemas.direccion &&
      !problemas.enlace &&
      (paraAgenda || horarios.valida));

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
      horarios: horarios.franjas(),
      retiroEnLocal,
    };
  }, [tieneLocal, direccion, enlaceUbicacion, horarios, retiroEnLocal, paraAgenda, lugar]);

  const resumenVentas = tieneLocal ? direccion.trim() || "Con local" : "Sólo online";
  const resumen = paraAgenda ? RESUMEN_LUGAR[opcionLugar] : resumenVentas;

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
    /** Los horarios del local (sólo ventas), para EditorSemana. */
    horarios,
    semana: horarios.semana,
    problemas,
    valido,
    payload,
    /** Para el riel del wizard. */
    resumen,
  };
}

export type LocalState = ReturnType<typeof useLocal>;
